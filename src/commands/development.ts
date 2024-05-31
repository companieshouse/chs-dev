import { Args, Command, Config } from "@oclif/core";

import { existsSync } from "fs";
import { join, relative } from "path";
import { cli } from "cli-ux";
import simpleGit from "simple-git";

import { Inventory, Service } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

export default class Development extends Command {
    static description = "list available services and enable / disable service";

    static examples = [
        "$ chs-dev development services",
        "$ chs-dev development enable [MODULE]",
        "$ chs-dev development disable [MODULE]"
    ];

    static args = {
        command: Args.string({
            required: true,
            options: ["services", "enable", "disable"]
        }),
        services: Args.string()
    };

    private inventory: Inventory;

    private stateManager: StateManager;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.inventory = new Inventory(join(config.root, ".."), config.configDir);
        this.stateManager = new StateManager(join(config.root, ".."));
    }

    async run (): Promise<void> {
        const { args } = await this.parse(Development);
        const services: string[] = args.services ? args.services.split(",") : [];
        switch (args.command) {
        case "services":
            this.printAvailableServices();
            break;
        case "enable":
            services.forEach(async service => {
                this.validateService(service);
                this.enableService(service);
                await this.config.runHook("generate-development-docker-compose", { serviceName: service });

                await this.cloneServiceRepository(service);

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

    private printAvailableServices (): void {
        this.log("Available services:");
        for (const service of this.inventory.services.filter(item => item.repository !== null && item.repository !== undefined)) {
            this.log(` - ${service.name} (${service.description})`);
        }
    }

    private validateService (serviceName: string) {
        if (serviceName === null || serviceName === undefined) {
            this.error("Service must be provided");
        }
        const service = this.inventory.services.find(item => item.name === serviceName);
        if (service === null || service === undefined) {
            this.error(`Service "${serviceName}" is not defined in inventory`);
        }
        if (service?.repository === null || service?.repository === undefined) {
            this.error(`Service "${serviceName}" does not have repository defined`);
        }
    }

    private enableService (serviceName: string) {
        this.stateManager.includeServiceInLiveUpdate(serviceName);
        this.log(`Service "${serviceName}" is enabled`);
    }

    private disableService (serviceName: string) {
        this.stateManager.excludeServiceFromLiveUpdate(serviceName);
        this.log(`Service "${serviceName}" is disabled`);
    }

    private async cloneServiceRepository (serviceName: string): Promise<void> {
        const service = this.inventory.services.find(item => item.name === serviceName) as Service;

        const localPath = join(this.config.root, "..", "repositories", service.name);
        if (!existsSync(localPath)) {
            cli.action.start(`Cloning ${service.repository!.branch || "default"} branch of ${service.repository!.url} repository to ${relative(this.config.root, localPath)} directory`);
            // @ts-ignore
            const git = simpleGit();

            await git.clone(service.repository!.url, localPath, service.repository?.branch ? ["--branch", service.repository.branch] : []);
            cli.action.stop("done");
        }
    }
}
