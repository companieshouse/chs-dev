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
        this.inventory = new Inventory(join(config.root, ".."), config.configDir);
        this.stateManager = new StateManager(join(config.root, ".."));
    }

    async run (): Promise<void> {
        const { args } = await this.parse(Modules);
        switch (args.command) {
        case "available":
            this.printAvailableModules();
            break;
        case "enable":
            this.validateModule(args.module);
            this.enableModule(args.module as string);
            await this.config.runHook("generate-runnable-docker-compose", {});
            break;
        case "disable":
            this.validateModule(args.module);
            this.disableModule(args.module as string);
            await this.config.runHook("generate-runnable-docker-compose", {});
            break;
        }
    }

    private printAvailableModules (): void {
        this.log("Available modules:");
        for (const module of this.inventory.modules) {
            this.log(` - ${module.name}`);
        }
    }

    private validateModule (moduleName?: string): void {
        if (moduleName === null || moduleName === undefined) {
            this.error("Module must be provided");
        }
        if (!this.inventory.modules.map(module => module.name).includes(moduleName)) {
            this.error(`Module "${moduleName}" is not defined in inventory`);
        }
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
