import { Args, Command, Config, Flags } from "@oclif/core";
import { StateManager } from "../../state/state-manager.js";
import ChsDevConfig from "../../model/Config.js";
import loadConfig from "../../helpers/config-loader.js";
import { DockerCompose } from "../../run/docker-compose.js";
import { confirm } from "../../helpers/user-input.js";

export default class Cache extends Command {

    static description = "Cache the state of chs-dev into a saved file";

    static args = {
        name: Args.string({
            required: false,
            description: "Name of the cache"
        })
    };

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
        const { args, flags } = await this.parse(Cache);
        const timestamp: string = new Date(Date.now()).toISOString();
        const cacheName: string = args.name || timestamp;

        const handlePrompt = async (): Promise<boolean> => {
            return await confirm(`save chs-dev state?`);
        };

        if (await handlePrompt()) {
            //
        }
    }

}
