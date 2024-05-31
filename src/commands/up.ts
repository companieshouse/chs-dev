import confirm from "@inquirer/confirm";
import { Command, Config } from "@oclif/core";
import { join } from "path";

import { DependencyCache } from "../run/dependency-cache.js";
import { DevelopmentMode } from "../run/development-mode.js";
import { DockerCompose } from "../run/docker-compose.js";
import { StateManager } from "../state/state-manager.js";

export default class Up extends Command {

    static description: string = "Brings up the docker-chs-development environment";

    static examples = [
        "$ chs-dev up"
    ];

    private readonly dependencyCache: DependencyCache;
    private readonly developmentMode: DevelopmentMode;
    private readonly dockerCompose: DockerCompose;
    private readonly stateManager: StateManager;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.dockerCompose = new DockerCompose(join(config.root, ".."), {
            log: (msg: string) => this.log(msg)
        });

        this.stateManager = new StateManager(join(config.root, ".."));
        this.dependencyCache = new DependencyCache(join(config.root, ".."));
        this.developmentMode = new DevelopmentMode(this.dockerCompose, join(config.root, ".."));
    }

    async run (): Promise<any> {
        await this.dockerCompose.up();

        if (this.stateManager.snapshot.servicesWithLiveUpdate.length > 0) {
            this.dependencyCache.update();

            await this.developmentMode.start((prompt) => confirm({
                message: prompt
            }));
        }
    }

}
