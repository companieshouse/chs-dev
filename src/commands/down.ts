import { Command, Config, Flags, ux } from "@oclif/core";

import { DockerCompose } from "../run/docker-compose.js";
import loadConfig from "../helpers/config-loader.js";
import { basename } from "path";
import { Config as ChsDevConfig } from "../model/Config.js";

export default class Down extends Command {

    static description: string = "Takes down the docker-chs-development environment";

    static examples = [
        "$ chs-dev down"
    ];

    static flags = {
        removeVolumes: Flags.boolean({
            name: "remove-volumes",
            char: "V",
            aliases: ["removeVolumes"],
            default: false,
            allowNo: false,
            description: "Will remove all associated volumes"
        })
    };

    private readonly dockerCompose: DockerCompose;
    private readonly chsDevConfig: ChsDevConfig;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        this.dockerCompose = new DockerCompose(this.chsDevConfig, {
            log: (msg: string) => this.log(msg)
        });
    }

    async run (): Promise<any> {
        ux.action.start(`Stopping chs-dev environment: ${basename(this.chsDevConfig.projectPath)}`);

        const { flags } = await this.parse(Down);

        await this.dockerCompose.down(flags.removeVolumes);

        ux.action.stop();
    }

}
