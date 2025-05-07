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

type ServicesBuildContext = {
    services: Service[];
    isNodePresent?: boolean;
    isJavaPresent?: boolean;
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
                const { services, isJavaPresent, isNodePresent } = this.servicesBuildContext;

                if (isNodePresent) {
                    this.log(
                        "Node Applications: Automatically sync changes.\n"
                    );
                }
                if (isJavaPresent) {
                    this.log(
                        "Non-Node Applications: To Sync changes, Run: '$ chs-dev reload <serviceName>' in a new shell session.\n"
                    );
                }

                const serviceNames = services.map(service => service.name).join(", ");
                this.log(`Waiting for Services: ${serviceNames} to be ready...\n`);

                if (isJavaPresent) {
                    const javaServicesNames = services.length > 1
                        ? services.filter(service => {
                            return service.builder === "java";
                        }).map(service => service.name)
                        : [services[0].name];
                    this.dockerCompose.healthCheck(javaServicesNames);
                }

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
                    builderMap.isNodePresent = true;
                } else if (builder === "java") {
                    builderMap.isJavaPresent = true;
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
}
