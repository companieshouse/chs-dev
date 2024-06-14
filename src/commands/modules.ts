import { join } from "path";

import { Args, Command, Config } from "@oclif/core";
import { IConfig } from "@oclif/config";

import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

export default class Modules extends Command {
    static description = "list available modules and enable / disable module";

    static examples = [
        "$ chs-dev modules available",
        "$ chs-dev modules enable [MODULE]",
        "$ chs-dev modules disable [MODULE]"
    ];

    static args = {
        command: Args.string({
            required: true,
            options: ["available", "enable", "disable"],
            default: "available"
        }),
        module: Args.string({
            required: false
        })
    };

    private inventory: Inventory;

    private stateManager: StateManager;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.inventory = new Inventory(process.cwd(), config.configDir);
        this.stateManager = new StateManager(process.cwd());
    }

    async run (): Promise<void> {
        const { args } = await this.parse(Modules);
        switch (args.command) {
        case "available":
            this.printAvailableModules();
            break;
        case "enable":
            if (this.validateModule(args.module)) {
                this.enableModule(args.module as string);
                await this.config.runHook("generate-runnable-docker-compose", {});
            }
            break;
        case "disable":
            if (this.validateModule(args.module)) {
                this.disableModule(args.module as string);
                await this.config.runHook("generate-runnable-docker-compose", {});
            }
            break;
        }
    }

    private printAvailableModules (): void {
        this.log("Available modules:");
        for (const module of this.inventory.modules) {
            this.log(` - ${module.name}`);
        }
    }

    private validateModule (moduleName?: string): boolean {
        if (moduleName === null || moduleName === undefined) {
            this.error("Module must be provided");
            return false;
        }
        if (!this.inventory.modules.map(module => module.name).includes(moduleName)) {
            this.error(`Module "${moduleName}" is not defined in inventory`);
            return false;
        }
        return true;
    }

    private enableModule (moduleName: string): void {
        this.stateManager.includeModule(moduleName);
        this.log(`Module "${moduleName}" is enabled`);
    }

    private disableModule (moduleName: string): void {
        this.stateManager.excludeModule(moduleName);
        this.log(`Module "${moduleName}" is disabled`);
    }
}
