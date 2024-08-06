import { Command, Config, Flags, ux } from "@oclif/core";

import { DockerCompose } from "../run/docker-compose.js";
import loadConfig from "../helpers/config-loader.js";
import { basename } from "path";
import { Config as ChsDevConfig } from "../model/Config.js";

export default class Down extends Command {

    static description: string = "Takes down the docker-chs-development environment";

    static examples = [
        {
            description: "Take down environment",
            command: "$ <%= config.bin %> <%= command.id %>"
        },
        {
            description: "Take down environment, removing all images and volumes created",
            command: "$ <%= config.bin %> <%= command.id %> -I -V"
        }
    ];

    static flags = {
        removeVolumes: Flags.boolean({
            name: "remove-volumes",
            char: "V",
            aliases: ["removeVolumes"],
            default: false,
            allowNo: false,
            description: "Will remove all associated volumes"
        }),
        removeImages: Flags.boolean({
            name: "remove-images",
            char: "I",
            aliases: ["removeImages"],
            default: false,
            allowNo: false,
            description: "Will remove all images built by the environment"
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

        await this.dockerCompose.down({
            removeVolumes: flags.removeVolumes,
            removeImages: flags.removeImages
        });

        ux.action.stop();
    }

}
