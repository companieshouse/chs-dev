import { Command, Config } from "@oclif/core";
import { cli } from "cli-ux";

import { DockerCompose } from "../run/docker-compose.js";
import loadConfig from "../helpers/config-loader.js";
import { basename } from "path";
import { Config as ChsDevConfig } from "../model/Config.js";

export default class Down extends Command {

    static description: string = "Takes down the docker-chs-development environment";

    static examples = [
        "$ chs-dev down"
    ];

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
        cli.action.start(`Stopping chs-dev environment: ${basename(this.chsDevConfig.projectPath)}`);

        await this.dockerCompose.down();

        cli.action.stop();
    }

}
