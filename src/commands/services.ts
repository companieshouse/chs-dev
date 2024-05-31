import { join } from "path";

import { Args, Command, Config } from "@oclif/core";
import { IConfig } from "@oclif/config";

import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

export default class Services extends Command {
    static description = "list available services and enable / disable service";

    static examples = [
        "$ chs-dev services available",
        "$ chs-dev services enable [SERVICE]",
        "$ chs-dev services disable [SERVICE]"
    ];

    static args = {
        command: Args.string({
            required: true,
            options: ["available", "enable", "disable"],
            default: "available"
        }),
        services: Args.string({
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
        const { args } = await this.parse(Services);
        const services: string[] = args.services ? args.services.split(",") : [];
        switch (args.command) {
        case "available":
            this.printAvailableServices();
            break;
        case "enable":
            services.forEach(service => {
                this.validateService(service);
                this.enableService(service);
            });
            await this.config.runHook("generate-runnable-docker-compose", {});
            break;
        case "disable":
            services.forEach(service => {
                this.validateService(service);
                this.disableService(service);
            });
            await this.config.runHook("generate-runnable-docker-compose", {});
            break;
        }
    }

    // Print all available services in alphabetical order
    private printAvailableServices (): void {
        this.log("Available services:");
        const services: string[] = [];
        for (const service of this.inventory.services) {
            services.push(service.name);
        }
        services.sort((a, b) => a.localeCompare(b));
        services.forEach((service) => {
            this.log(` - ${service}`);
        });
    }

    private validateService (serviceName: string): void {
        if (serviceName === null || serviceName === undefined) {
            this.error("Service must be provided");
        }
        if (!this.inventory.services.map(service => service.name).includes(serviceName)) {
            this.error(`Service "${serviceName}" is not defined in inventory`);
        }
    }

    private enableService (serviceName: string): void {
        this.stateManager.includeService(serviceName);
        this.log(`Service "${serviceName}" is enabled`);
    }

    private disableService (serviceName: string): void {
        this.stateManager.excludeService(serviceName);
        this.log(`Service "${serviceName}" is disabled`);
    }
}
