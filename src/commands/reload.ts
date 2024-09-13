import { Args, Command, Config, Flags } from "@oclif/core";
import { Inventory } from "../state/inventory.js";
import { join } from "path";
import fsExtra from "fs-extra";
import { DependencyCache } from "../run/dependency-cache.js";
import ChsDevConfig from "../model/Config.js";
import loadConfig from "../helpers/config-loader.js";
import { existsSync, unlinkSync } from "fs";

export default class Reload extends Command {

    static description = "Rebuilds and restarts the supplied service running " +
        "in development mode to load in any changes to source code";

    static args = {
        service: Args.string({
            required: true,
            description: "Name of the service"
        })
    };

    static flags = {
        force: Flags.boolean({
            required: false,
            allowNo: false,
            default: false,
            description: "Forcefully reload service and force a rebuild",
            name: "force",
            char: "f",
            aliases: ["force"]
        })
    };

    private readonly inventory: Inventory;
    private readonly dependencyCache: DependencyCache;
    private readonly chsDevConfig: ChsDevConfig;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.dependencyCache = new DependencyCache(this.chsDevConfig.projectPath);
    }

    async run (): Promise<any> {
        const { args, flags } = await this.parse(Reload);

        const serviceName: string = args.service;
        const codeHashFile = join(
            this.chsDevConfig.projectPath,
            "local",
            serviceName,
            "out/.code.hash"
        );

        if (flags.force && existsSync(codeHashFile)) {
            unlinkSync(codeHashFile);
        }

        if (this.isServiceValid(serviceName)) {
            const touchFile = join(this.chsDevConfig.projectPath, "local", serviceName, ".touch");

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
