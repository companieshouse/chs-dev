import { Args, Command, Config } from "@oclif/core";
import { Inventory } from "../state/inventory.js";
import { join } from "path";
import fsExtra from "fs-extra";
import { DependencyCache } from "../run/dependency-cache.js";

export default class Reload extends Command {

    static args = {
        service: Args.string({
            required: true,
            description: "Name of the service"
        })
    };

    private readonly inventory: Inventory;
    private readonly dependencyCache: DependencyCache;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.inventory = new Inventory(join(config.root, ".."), config.configDir);
        this.dependencyCache = new DependencyCache(join(config.root, ".."));
    }

    async run (): Promise<any> {
        const { args } = await this.parse(Reload);

        const serviceName: string = args.service;

        if (this.inventory.services.some(service => service.name === serviceName)) {
            const touchFile = join(this.config.root, "..", "local", serviceName, ".touch");

            this.dependencyCache.update();

            await fsExtra.ensureFile(touchFile);

            const now = new Date();

            await fsExtra.utimes(touchFile, now, now);
        }
    }

}
