import { join } from "path";

import { Args, Command, Config } from "@oclif/core";

import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

export default class Exclusions extends Command {
    static description = "list available services and enable / disable service";

    static examples = [
        "$ chs-dev exclusions exclude [EXCLUSION]",
        "$ chs-dev exclusions include [EXCLUSION]"
    ];

    static args = {
        command: Args.string({
            required: true,
            options: ["exclude", "include"]
        }),
        exclusions: Args.string({
            required: false
        })
    };

    private stateManager: StateManager;

    private inventory: Inventory;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.stateManager = new StateManager(process.cwd());
        this.inventory = new Inventory(process.cwd(), config.configDir);
    }

    async run (): Promise<void> {
        const { args } = await this.parse(Exclusions);
        const exclusions: string[] = args.exclusions ? args.exclusions.split(",") : [];
        switch (args.command) {
        case "exclude":
            exclusions.forEach(exclusion => {
                this.excludeFile(exclusion);
            });
            break;
        case "include":
            exclusions.forEach(exclusion => {
                this.includeFile(exclusion);
            });
            break;
        }
        await this.config.runHook("generate-runnable-docker-compose", {});
    }

    private excludeFile (file: string): void {
        this.validateService(file);
        this.stateManager.includeFile(file);
        this.log(`File "${file}" is excluded`);
    }

    private includeFile (file: string): void {
        this.validateService(file);
        this.stateManager.excludeFile(file);
        this.log(`File "${file}" is included`);
    }

    private validateService (serviceName: string): void {
        if (serviceName === null || serviceName === undefined) {
            this.error("Exclusion must be provided");
        }
        if (!this.inventory.services.map(service => service.name).includes(serviceName)) {
            this.error(`Excluded service "${serviceName}" is not defined in inventory`);
        }
    }
}
