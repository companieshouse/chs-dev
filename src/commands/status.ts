import { Command, Config } from "@oclif/core";

import { Inventory, Service } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { collect, deduplicate } from "../helpers/array-reducers.js";
import { DockerCompose } from "../run/docker-compose.js";
import { join } from "path";

export default class Status extends Command {
    static description = "print status of an environment";

    static examples = [
        "$ chs-dev status"
    ];

    private inventory: Inventory;

    private stateManager: StateManager;

    private dockerCompose: DockerCompose;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.inventory = new Inventory(process.cwd(), config.cacheDir);
        this.stateManager = new StateManager(process.cwd());
        this.dockerCompose = new DockerCompose(process.cwd(), {
            log: (msg: string) => this.log(msg)
        });
    }

    async run (): Promise<void> {
        const state = this.stateManager.snapshot;
        const dockerComposeState = this.dockerCompose.getServiceStatuses();

        const serviceState = (serviceName: string) => dockerComposeState ? `(${dockerComposeState[serviceName]})` || "(Not running)" : "";

        this.log("Manually activated modules:");
        for (const module of state.modules) {
            this.log(` - ${module}`);
        }

        this.log("\nManually activated services:");
        for (const service of state.services) {
            this.log(` - ${service} ${serviceState(service)}`);
        }

        this.log("\nAutomatically activated services:");
        const enabledServiceNames = this.inventory.services
            .filter(service => state.modules.includes(service.module) || state.services.includes(service.name))
            .reduce(collect<string, Service>(service => [service.name, ...service.dependsOn || []]), [])
            .reduce(deduplicate, [])
            .sort();
        for (const serviceName of enabledServiceNames) {
            this.log(` - ${serviceName} ${serviceState(serviceName)} ${state.servicesWithLiveUpdate.includes(serviceName) ? "[LIVE UPDATE]" : ""}`);
        }

        this.log("\nManually deactivated services:");
        for (const file of state.excludedFiles || []) {
            this.log(` - ${file}`);
        }
    }
}
