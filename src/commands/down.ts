import { Command, Config } from "@oclif/core";
import { IConfig } from "@oclif/config";
import { join } from "path";

import { DockerCompose } from "../run/docker-compose.js";

export default class Down extends Command {

    static description: string = "Takes down the docker-chs-development environment";

    static examples = [
        "$ chs-dev down"
    ];

    private readonly dockerCompose: DockerCompose;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.dockerCompose = new DockerCompose(join(config.root, ".."), {
            log: (msg: string) => this.log(msg)
        });
    }

    async run (): Promise<any> {
        return await this.dockerCompose.down();
    }

}
