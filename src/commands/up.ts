import confirm from "@inquirer/confirm";
import { Command, Config, Flags, ux } from "@oclif/core";

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
import { OtelGenerator } from "../generator/otel-generator.js";
import { documentationLink } from "../helpers/link.js";

type ServicesBuildContext = {
    services: Service[];
    hasNodeBuilder?: boolean;
    hasJavaBuilder?: boolean;
    hasNginxBuilder?: boolean;
    hasNoBuilder?: boolean;
    hasRepositoryBuilder?: boolean
};

const DOCUMENTATION_LINK = "troubleshooting-remedies/correctly-reload-repository-services-using-chs-dev.md";
export default class Up extends Command {

    static description: string = "Brings up the docker-chs-development environment";

    static flags = {
        otel: Flags.boolean({
            aliases: ["otel"],
            default: false,
            description: "Enable OpenTelemetry for tracing"
        }),
        "no-otel": Flags.boolean({
            aliases: ["no-otel"],
            description: "Disable OpenTelemetry for tracing"
        })
    };

    static examples = [
        "$ chs-dev up",
        "$ chs-dev up --otel",
        "$ chs-dev up --no-otel"
    ];

    private readonly dependencyCache: DependencyCache;
    private readonly dockerCompose: DockerCompose;
    private readonly stateManager: StateManager;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly composeLogViewer: ComposeLogViewer;
    private readonly inventory: Inventory;
    private readonly permanentRepositories: PermanentRepositories;
    private readonly otelGenerator: OtelGenerator;
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
        this.otelGenerator = new OtelGenerator(this.chsDevConfig.projectPath);
    }

    async run (): Promise<any> {
        const { flags } = await this.parse(Up);

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

        this.otelGenerator.modifyGeneratedDockerCompose(flags);

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
            await this.handleDevelopmentMode();

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
                } else if (builder === "repository") {
                    builderMap.hasRepositoryBuilder = true;
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

    private handleReloadInstructions (builders: ServicesBuildContext): void {
        const instructions: string[] = [];
        const { hasNodeBuilder, hasJavaBuilder, hasNginxBuilder, hasRepositoryBuilder, hasNoBuilder } = builders;

        if (hasNodeBuilder) {
            instructions.push("Node Applications: Automatically sync changes.\n");
        }

        if (hasJavaBuilder || hasNginxBuilder) {
            instructions.push("Java and Nginx Applications: To sync changes, run: '$ chs-dev reload <serviceName>'.\n");
        }

        if (hasRepositoryBuilder || hasNoBuilder) {
            instructions.push(`Repository Applications[Java, Go and Perl]: For the build and sync procedure, refer to ${documentationLink(DOCUMENTATION_LINK)}. \n`);
        }

        if (instructions.length > 0) {
            this.log(instructions.join("\n"));
        }
    }

    private handleWaitReadyInstructions (builders: ServicesBuildContext): void {
        const { services, hasNodeBuilder, hasJavaBuilder, hasNginxBuilder, hasRepositoryBuilder, hasNoBuilder } = builders;
        const serviceNames = services.map(service => service.name).join(", ");

        if (hasNodeBuilder || hasJavaBuilder || hasRepositoryBuilder || hasNoBuilder) {
            this.log(`Waiting for Services: ${serviceNames} to be ready...\n`);
        }

        // Logic to be moved to dockerComposeWatchLogHandler once there is a way to track nginx logs
        if (hasNginxBuilder) {
            const serviceNames = services.filter(service => service.builder === "nginx").map(service => service.name).join(", ");
            const timestamp = new Date().toISOString();
            this.log((greenBright(`${timestamp} - Service: ${serviceNames} ready!`)));
        }

    }

    private handleHealthCheck (builders: ServicesBuildContext): void {
        const { services, hasJavaBuilder, hasRepositoryBuilder, hasNoBuilder } = builders;
        if (hasJavaBuilder || hasRepositoryBuilder || hasNoBuilder) {
            const javaRepositoryAndNoBuilderServicesNames = services.length > 1
                ? services.filter(service => {
                    return service.builder.includes("java") || service.builder.includes("repository") || !service.builder;
                }).map(service => service.name)
                : [services[0].name];
            this.dockerCompose.healthCheck(javaRepositoryAndNoBuilderServicesNames);
        }
    }

    private async handleDevelopmentMode (): Promise<void> {
        if (this.hasServicesInDevelopmentMode) {
            const builderContext = this.servicesBuildContext;
            const { hasNodeBuilder, hasNginxBuilder } = builderContext;

            this.log(
                `Running services in development mode ${hasNodeBuilder || hasNginxBuilder ? " - watching for changes." : "."} \n`
            );

            this.handleReloadInstructions(builderContext);

            this.handleWaitReadyInstructions(builderContext);

            this.handleHealthCheck(builderContext);

            this.dependencyCache.update();
            const logsArgs = {
                serviceNames: this.servicesInDevelopmentMode,
                tail: "10",
                follow: true
            };
            if (hasNodeBuilder || hasNginxBuilder) {
                const developmentMode = new DevelopmentMode(this.dockerCompose, logsArgs);
                await developmentMode.start((prompt) => confirm({
                    message: prompt
                }));
            }
        }
    }
}
