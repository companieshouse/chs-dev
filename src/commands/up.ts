import confirm from "@inquirer/confirm";
import { Command, Config, ux } from "@oclif/core";

import { basename } from "path";
import loadConfig from "../helpers/config-loader.js";
import { Config as ChsDevConfig } from "../model/Config.js";
import { ComposeLogViewer } from "../run/compose-log-viewer.js";
import { DependencyCache } from "../run/dependency-cache.js";
import { DevelopmentMode } from "../run/development-mode.js";
import { DockerCompose } from "../run/docker-compose.js";
import { Inventory } from "../state/inventory.js";
import { PermanentRepositories } from "../state/permanent-repositories.js";
import { StateManager } from "../state/state-manager.js";
import Service from "../model/Service.js";
import { greenBright } from "ansis";

type ServicesBuildContext = {
    services: Service[];
    hasNodeBuilder?: boolean;
    hasJavaBuilder?: boolean;
    hasNginxBuilder?: boolean;
    hasNoBuilder?: boolean;
};
export default class Up extends Command {

    static description: string = "Brings up the docker-chs-development environment";

    static examples = [
        "$ chs-dev up"
    ];

    private readonly dependencyCache: DependencyCache;
    private readonly dockerCompose: DockerCompose;
    private readonly stateManager: StateManager;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly composeLogViewer: ComposeLogViewer;
    private readonly inventory: Inventory;
    private readonly permanentRepositories: PermanentRepositories;
    private servicesBuildContext!: ServicesBuildContext;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        const logger = {
            log: (msg: string) => this.log(msg)
        };

        this.dockerCompose = new DockerCompose(this.chsDevConfig, logger);

        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.dependencyCache = new DependencyCache(this.chsDevConfig.projectPath);
        this.composeLogViewer = new ComposeLogViewer(this.chsDevConfig, logger);
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.permanentRepositories = new PermanentRepositories(this.chsDevConfig, this.inventory);
    }

    async run (): Promise<any> {
        await this.config.runHook(
            "validate-project-state", {
                requiredFiles: [
                    "docker-compose.yaml"
                ],
                suggestionsOnFailure: [
                    "Try rerunning the command from a valid project with docker-compose.yaml",
                    "Try enabling a service you already have enabled to force recreation of docker-compose.yaml file"
                ]
            }
        );

        try {
            await this.config.runHook("ensure-ecr-logged-in", {});
        } catch (error) {
            return this.error(error as Error, {
                suggestions: [
                    "Login to ECR manually and try again"
                ]
            });
        }

        if (this.hasServicesInDevelopmentMode) {
            try {
                this.servicesBuildContext = this.getServicesBuildContext(this.servicesInDevelopmentMode);
                const hookOptions: Record<string, Service[]> = {
                    services: this.servicesBuildContext.services
                };
                await this.config.runHook("check-development-service-config", hookOptions);
            } catch (error) {
                return this.error(error as Error);
            }
        }

        ux.action.start("Synchronising current services in development mode with inventory");
        await this.synchroniseServicesInDevelopmentMode();
        ux.action.stop();

        ux.action.start("Ensuring all permanent repos are up to date");
        await this.permanentRepositories.ensureAllExistAndAreUpToDate();
        ux.action.stop();

        ux.action.start(`Running chs-dev environment: ${basename(this.chsDevConfig.projectPath)}`);
        try {
            await this.dockerCompose.up();

            if (this.hasServicesInDevelopmentMode) {
                this.log(
                    "Running services in development mode - watching for changes.\n"
                );
                const { services, hasJavaBuilder, hasNodeBuilder, hasNginxBuilder, hasNoBuilder } = this.servicesBuildContext;

                this.logReloadInstructions(hasNodeBuilder, hasJavaBuilder, hasNginxBuilder, hasNoBuilder);

                this.logWaitReadyInstructions(services, hasNodeBuilder, hasJavaBuilder, hasNginxBuilder, hasNoBuilder);

                this.runHealthCheck(services, hasJavaBuilder, hasNoBuilder);

                this.dependencyCache.update();
                const logsArgs = {
                    serviceNames: this.servicesInDevelopmentMode,
                    tail: "10",
                    follow: true
                };

                const developmentMode = new DevelopmentMode(this.dockerCompose, logsArgs);
                await developmentMode.start((prompt) => confirm({
                    message: prompt
                }));
            }
        } catch (error) {
            this.log(`\n${"-".repeat(80)}`);
            this.log("Recent Docker Compose Logs:");

            await this.composeLogViewer.view({
                tail: "5",
                follow: false
            });

            this.error(error as Error);
        }
        ux.action.stop();
    }

    private get hasServicesInDevelopmentMode (): boolean {
        return this.servicesInDevelopmentMode.length > 0;
    }

    private get servicesInDevelopmentMode (): string[] {
        return this.stateManager.snapshot.servicesWithLiveUpdate;
    }

    private getServicesBuildContext (services: string[]): ServicesBuildContext {
        return services.reduce((builderMap, serviceName) => {
            const service = this.inventory.services.find(
                s => s.name === serviceName && !s.source.includes("tilt/")
            );
            if (service) {
                const builder = service.builder || "undefined";
                if (builder === "node") {
                    builderMap.hasNodeBuilder = true;
                } else if (builder.includes("java")) {
                    builderMap.hasJavaBuilder = true;
                } else if (builder === "nginx") {
                    builderMap.hasNginxBuilder = true;
                } else if (!builder || builder === "undefined") {
                    builderMap.hasNoBuilder = true;
                }
                if (!Array.isArray(builderMap.services)) {
                    builderMap.services = [];
                }
                builderMap.services.push(service);
            }
            return builderMap;
        }, {} as ServicesBuildContext);
    }

    private async synchroniseServicesInDevelopmentMode (): Promise<any> {
        for (const serviceInDevelopmentMode of this.stateManager.snapshot.servicesWithLiveUpdate) {
            await this.config.runHook("generate-development-docker-compose", {
                serviceName: serviceInDevelopmentMode
            });
        }
    }

    private logReloadInstructions (hasNodeBuilder: boolean | undefined, hasJavaBuilder: boolean | undefined, hasNginxBuilder: boolean | undefined, hasNoBuilder: boolean | undefined): void {
        const instructions: string[] = [];

        if (hasNodeBuilder) {
            instructions.push("Node Applications: Automatically sync changes.\n");
        }

        if (hasJavaBuilder || hasNginxBuilder) {
            instructions.push("Java and Nginx Applications: To sync changes, run: '$ chs-dev reload <serviceName>' in a new shell session.\n");
        }

        if (hasNoBuilder) {
            instructions.push("Repository Applications[Go and Perl]: Build and sync procedure remains the same.\n");
        }

        if (instructions.length > 0) {
            this.log(instructions.join("\n"));
        }
    }

    private logWaitReadyInstructions (services: Service[], hasNodeBuilder: boolean | undefined, hasJavaBuilder: boolean | undefined, hasNginxBuilder: boolean | undefined, hasNoBuilder: boolean | undefined): void {
        const serviceNames = services.map(service => service.name).join(", ");

        if (hasNodeBuilder || hasJavaBuilder || hasNoBuilder) {
            this.log(`Waiting for Services: ${serviceNames} to be ready...\n`);
        }

        // Logic to be moved to dockerComposeWatchLogHandler once there is a way to track nginx logs
        if (hasNginxBuilder) {
            const serviceNames = services.filter(service => service.builder === "nginx").map(service => service.name).join(", ");
            const timestamp = new Date().toISOString();
            this.log((greenBright(`${timestamp} - Service: ${serviceNames} ready!`)));
        }

    }

    private runHealthCheck (services: Service[], hasJavaBuilder: boolean | undefined, hasNoBuilder: boolean | undefined): void {
        if (hasJavaBuilder || hasNoBuilder) {
            const javaAndNoBuilderServicesNames = services.length > 1
                ? services.filter(service => {
                    return service.builder.includes("java") || !service.builder;
                }).map(service => service.name)
                : [services[0].name];
            this.dockerCompose.healthCheck(javaAndNoBuilderServicesNames);
        }
    }
}
