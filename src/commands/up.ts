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

        cli.action.start(`Running chs-dev environment: ${basename(this.chsDevConfig.projectPath)}`);
        try {
            await this.dockerCompose.up();

            if (this.stateManager.snapshot.servicesWithLiveUpdate.length > 0) {
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

}
