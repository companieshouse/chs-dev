import confirm from "@inquirer/confirm";
import { Command, Config } from "@oclif/core";
import { cli } from "cli-ux";

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

        this.stateManager = new StateManager(process.cwd());
        this.dependencyCache = new DependencyCache(process.cwd());
        this.developmentMode = new DevelopmentMode(this.dockerCompose, process.cwd());
        this.composeLogViewer = new ComposeLogViewer(this.chsDevConfig, logger);
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.permanentRepositories = new PermanentRepositories(this.chsDevConfig, this.inventory);
    }

    async run (): Promise<any> {
        try {
            await this.config.runHook("ensure-ecr-logged-in", {});
        } catch (error) {
            return this.error(error as Error, {
                suggestions: [
                    "Login to ECR manually and try again"
                ]
            });
        }

        cli.action.start("Ensuring all permanent repos are up to date");
        await this.permanentRepositories.ensureAllExistAndAreUpToDate();
        cli.action.stop();

        cli.action.start(`Running chs-dev environment: ${basename(this.chsDevConfig.projectPath)}`);
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
        cli.action.stop();
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
}
