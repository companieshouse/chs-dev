import { Command, Config, Flags } from "@oclif/core";

import { statusColouriser } from "../helpers/colouriser.js";
import loadConfig from "../helpers/config-loader.js";
import ChsDevConfig from "../model/Config.js";
import State from "../model/State.js";
import { DockerCompose } from "../run/docker-compose.js";
import { ServiceLoader } from "../run/service-loader.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { OtelGenerator } from "../generator/otel-generator.js";

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

    private readonly otelGenerator: OtelGenerator;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.chsDevConfig = loadConfig();
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.dockerCompose = new DockerCompose(this.chsDevConfig, {
            log: (msg: string) => this.log(msg)
        });
        this.otelGenerator = new OtelGenerator(this.chsDevConfig.projectPath);
    }

    async run (): Promise<void> {
        try {
            await this.config.runHook("ensure-ecr-logged-in", {});
        } catch (error) {
            return this.error(error as Error, {
                suggestions: [
                    "Login to ECR manually and try again"
                ]
            });
        }

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

        const serviceLoader = new ServiceLoader(this.inventory);
        let enabledServiceNames = serviceLoader.loadServicesNames(state);

        const enabledOtelServiceNames = dockerComposeState
            ? this.otelGenerator.otelServiceNames.filter(serviceName => serviceName in dockerComposeState)
            : [];

        enabledServiceNames = [...enabledServiceNames, ...enabledOtelServiceNames].sort();

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
                liveUpdate: state.servicesWithLiveUpdate.includes(serviceName),
                transient: !state.services.includes(serviceName)
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
            this.log(` - ${serviceName} ${serviceState(serviceName, true)} ${state.servicesWithLiveUpdate.includes(serviceName) ? "[LIVE UPDATE]" : ""}`);
        }

        this.log("\nManually deactivated services:");
        for (const file of state.excludedServices || []) {
            this.log(` - ${file}`);
        }
    }
}
