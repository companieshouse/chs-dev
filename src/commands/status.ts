import { Command, Config, Flags } from "@oclif/core";

import { Inventory } from "../state/inventory.js";
import { Service } from "../model/Service.js";
import { StateManager } from "../state/state-manager.js";
import { collect, deduplicate } from "../helpers/array-reducers.js";
import { DockerCompose } from "../run/docker-compose.js";
import loadConfig from "../helpers/config-loader.js";
import State from "../model/State.js";

export default class Status extends Command {
    static description = "print status of an environment";

    static examples = [
        "$ chs-dev status"
    ];

    static flags = {
        json: Flags.boolean({
            name: "json",
            char: "j",
            aliases: ["json"],
            default: false,
            allowNo: false,
            description: "output as json"
        })
    };

    private inventory: Inventory;

    private stateManager: StateManager;

    private dockerCompose: DockerCompose;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.inventory = new Inventory(process.cwd(), config.cacheDir);
        this.stateManager = new StateManager(process.cwd());
        this.dockerCompose = new DockerCompose(loadConfig(), {
            log: (msg: string) => this.log(msg)
        });
    }

    async run (): Promise<void> {
        const state = this.stateManager.snapshot;
        const dockerComposeState = this.dockerCompose.getServiceStatuses();

        const serviceState = (serviceName: string) => dockerComposeState ? `(${dockerComposeState[serviceName]})` || "(Not running)" : "";
        const { flags } = await this.parse(Status);

        const enabledServiceNames = this.inventory.services
            .filter(service => state.modules.includes(service.module) || state.services.includes(service.name))
            .reduce(collect<string, Service>(service => [service.name, ...service.dependsOn || []]), [])
            .reduce(deduplicate, [])
            .sort();

        if (flags.json) {
            const jsonRepresentation = this.constructJsonRepresentation(
                state, enabledServiceNames, serviceState
            );

            this.logJson(jsonRepresentation);
        } else {
            this.humanReadableLog(state, serviceState, enabledServiceNames);
        }
    }

    private constructJsonRepresentation (
        state: State,
        enabledServiceNames: string[],
        serviceState: (serviceName: string) => string
    ) {
        return {
            modules: [
                ...state.modules
            ],
            services: enabledServiceNames.map((serviceName: string) => ({
                name: serviceName,
                composeStatus: serviceState(serviceName).replaceAll(/[()]/g, ""),
                liveUpdate: state.servicesWithLiveUpdate.includes(serviceName),
                transient: !state.services.includes(serviceName)
            }))
        };
    }

    private humanReadableLog (
        state: State,
        serviceState: (serviceName: string) => string,
        enabledServiceNames: string[]
    ) {
        this.log("Manually activated modules:");
        for (const module of state.modules) {
            this.log(` - ${module}`);
        }

        this.log("\nManually activated services:");
        for (const service of state.services) {
            this.log(` - ${service} ${serviceState(service)}`);
        }

        this.log("\nAutomatically activated services:");
        for (const serviceName of enabledServiceNames) {
            this.log(` - ${serviceName} ${serviceState(serviceName)} ${state.servicesWithLiveUpdate.includes(serviceName) ? "[LIVE UPDATE]" : ""}`);
        }

        this.log("\nManually deactivated services:");
        for (const file of state.excludedServices || []) {
            this.log(` - ${file}`);
        }
    }
}
