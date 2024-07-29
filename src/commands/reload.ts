import { Args, Command, Config } from "@oclif/core";
import { Inventory } from "../state/inventory.js";
import { join } from "path";
import fsExtra from "fs-extra";
import { DependencyCache } from "../run/dependency-cache.js";

export default class Reload extends Command {

    static description = "Rebuilds and restarts the supplied service running " +
        "in development mode to load in any changes to source code";

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
        this.inventory = new Inventory(process.cwd(), config.cacheDir);
        this.dependencyCache = new DependencyCache(process.cwd());
    }

    async run (): Promise<any> {
        const { args } = await this.parse(Reload);

        const serviceName: string = args.service;

        if (this.isServiceValid(serviceName)) {
            const touchFile = join(process.cwd(), "local", serviceName, ".touch");

            this.dependencyCache.update();

            await fsExtra.ensureFile(touchFile);

            const now = Date.now();

            await fsExtra.utimes(touchFile, now, now);
        }
    }

    private isServiceValid (serviceName?: string): boolean {
        if (!this.inventory.services.some(service => service.name === serviceName)) {
            this.error(`Service ${serviceName} is not found in inventory`);
            return false;
        }

        return true;
    }

}
