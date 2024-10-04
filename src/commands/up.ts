import confirm from "@inquirer/confirm";
import { Command, Config, ux } from "@oclif/core";

import { DependencyCache } from "../run/dependency-cache.js";
import { DevelopmentMode } from "../run/development-mode.js";
import { DockerCompose } from "../run/docker-compose.js";
import { StateManager } from "../state/state-manager.js";
import loadConfig from "../helpers/config-loader.js";
import { basename } from "path";
import { Config as ChsDevConfig } from "../model/Config.js";
import { ComposeLogViewer } from "../run/compose-log-viewer.js";
import { PermanentRepositories } from "../state/permanent-repositories.js";
import { Inventory } from "../state/inventory.js";
import { spawn } from "../helpers/spawn-promise.js";
import LogEverythingLogHandler from "../run/logs/LogEverythingLogHandler.js";

export default class Up extends Command {

    static description: string = "Brings up the docker-chs-development environment";

    static examples = [
        "$ chs-dev up"
    ];

    private readonly dependencyCache: DependencyCache;
    private readonly developmentMode: DevelopmentMode;
    private readonly dockerCompose: DockerCompose;
    private readonly stateManager: StateManager;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly composeLogViewer: ComposeLogViewer;
    private readonly inventory: Inventory;
    private readonly permanentRepositories: PermanentRepositories;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        const logger = {
            log: (msg: string) => this.log(msg)
        };

        this.dockerCompose = new DockerCompose(this.chsDevConfig, logger);

        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.dependencyCache = new DependencyCache(this.chsDevConfig.projectPath);
        this.developmentMode = new DevelopmentMode(this.dockerCompose);
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

        ux.action.start("Synchronising current services in development mode with inventory");
        await this.synchroniseServicesInDevelopmentMode();
        ux.action.stop();

        ux.action.start("Ensuring all permanent repos are up to date");
        await this.permanentRepositories.ensureAllExistAndAreUpToDate();
        ux.action.stop();

        ux.action.start(`Running chs-dev environment: ${basename(this.chsDevConfig.projectPath)}`);
        try {
            await this.dockerCompose.up();

            if (this.hasServicesInDevelopmentMode()) {
                this.log("Waiting for Development Mode to be ready (this can take a moment or two)...");

                this.dependencyCache.update();

                await this.developmentMode.start((prompt) => confirm({
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

    private hasServicesInDevelopmentMode (): boolean {
        if (this.stateManager.snapshot.servicesWithLiveUpdate.length > 0) {
            return this.hasServiceEnabledInLiveUpdate() ||
                this.hasServiceFromEnabledModuleInLiveUpdate();
        }

        return false;
    }

    private hasServiceFromEnabledModuleInLiveUpdate (): boolean {
        return this.inventory.services.filter(service => this.stateManager.snapshot.modules.includes(service.module))
            .some(service => this.stateManager.snapshot.servicesWithLiveUpdate.includes(service.name));
    }

    private hasServiceEnabledInLiveUpdate (): boolean {
        return this.stateManager.snapshot.servicesWithLiveUpdate
            .some(serviceWithLiveUpdate => {
                const service = this.stateManager.snapshot.services.find(serviceName => serviceName === serviceWithLiveUpdate);

                return typeof service !== "undefined";
            });
    }

    private async synchroniseServicesInDevelopmentMode (): Promise<any> {
        for (const serviceInDevelopmentMode of this.stateManager.snapshot.servicesWithLiveUpdate) {
            await this.config.runHook("generate-development-docker-compose", {
                serviceName: serviceInDevelopmentMode
            });
        }
    }
}
