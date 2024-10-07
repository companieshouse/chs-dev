import { Command, Config, Flags } from "@oclif/core";

import { Inventory } from "../state/inventory.js";
import { Service } from "../model/Service.js";
import { StateManager } from "../state/state-manager.js";
import { collect, deduplicate } from "../helpers/array-reducers.js";
import { DockerCompose } from "../run/docker-compose.js";
import loadConfig from "../helpers/config-loader.js";
import State from "../model/State.js";
import ChsDevConfig from "../model/Config.js";
import { statusColouriser } from "../helpers/colouriser.js";
import { isTransientService } from "../helpers/transient-service.js";

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

    private chsDevConfig: ChsDevConfig;

    private isTransient: (serviceName: string) => boolean;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.chsDevConfig = loadConfig();
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.dockerCompose = new DockerCompose(this.chsDevConfig, {
            log: (msg: string) => this.log(msg)
        });
        this.isTransient = isTransientService(this.stateManager.snapshot, this.inventory);
    }

    async run (): Promise<void> {
        const state = this.stateManager.snapshot;
        const dockerComposeState = this.dockerCompose.getServiceStatuses();

        const serviceState = (serviceName: string, colourise: boolean) => {
            const stateValue = dockerComposeState ? dockerComposeState[serviceName] || "Not running" : "";

            if (colourise && dockerComposeState) {
                return `(${statusColouriser(stateValue)})`;
            }

            return stateValue;

        };
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
        serviceState: (serviceName: string, colourise: boolean) => string
    ) {
        return {
            modules: [
                ...state.modules
            ],
            services: enabledServiceNames.map((serviceName: string) => ({
                name: serviceName,
                composeStatus: serviceState(serviceName, false).replaceAll(/[()]/g, ""),
                liveUpdate: this.isServiceInLiveUpdate(state, serviceName),
                transient: this.isTransient(serviceName),
                excluded: state.excludedServices.includes(serviceName)
            }))
        };
    }

    private humanReadableLog (
        state: State,
        serviceState: (serviceName: string, colourise: boolean) => string,
        enabledServiceNames: string[]
    ) {
        this.log("Manually activated modules:");
        for (const module of state.modules) {
            this.log(` - ${module}`);
        }

        this.log("\nManually activated services:");
        for (const service of state.services) {
            this.log(` - ${service} ${serviceState(service, true)}`);
        }

        this.log("\nAutomatically activated services:");
        for (const serviceName of enabledServiceNames) {
            this.log(` - ${serviceName} ${serviceState(serviceName, true)} ${this.createServiceLabel(state, serviceName)}`);
        }

        this.log("\nManually deactivated services:");
        for (const file of state.excludedServices || []) {
            this.log(` - ${file}`);
        }
    }

    private createServiceLabel (state: State, serviceName: string): string {
        return this.isServiceInLiveUpdate(state, serviceName)
            ? "[LIVE UPDATE]"
            : state.excludedServices.includes(serviceName)
                ? "[EXCLUDED]"
                : "";
    }

    private isServiceInLiveUpdate (state: State, serviceName: string): boolean {
        return state.servicesWithLiveUpdate.includes(serviceName) && !this.isTransient(serviceName);
    }
}
