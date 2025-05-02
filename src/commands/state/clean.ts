import { Command, Config, Flags } from "@oclif/core";
import { StateManager } from "../../state/state-manager.js";
import ChsDevConfig from "../../model/Config.js";
import loadConfig from "../../helpers/config-loader.js";
import { DockerCompose } from "../../run/docker-compose.js";
import { confirm } from "../../helpers/user-input.js";

export default class Clean extends Command {

    static description = "Wipes the state of chs-dev and revert to a default state";

    private readonly stateManager: StateManager;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly dockerCompose: DockerCompose;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        const logger = {
            log: (msg: string) => this.log(msg)
        };
        this.chsDevConfig = loadConfig();
        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.dockerCompose = new DockerCompose(this.chsDevConfig, logger);

    }

    async run (): Promise<any> {
        await this.parse(Clean);

        const handlePrompt = async (): Promise<boolean> => {
            return await confirm(`This will reset your chs-dev state and delete all unused docker volumes. Do you want to proceed?`);
        };

        if (await handlePrompt()) {
            this.stateManager.cleanState();

            await this.config.runHook("generate-runnable-docker-compose", {
                generateExclusionSpec: false
            });

            // Run docker purne volumes;
            this.dockerCompose.prune("volume");

        }
    }

}
