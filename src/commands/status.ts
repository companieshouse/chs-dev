import { Command, Config, Flags } from "@oclif/core";

import { statusColouriser } from "../helpers/colouriser.js";
import loadConfig from "../helpers/config-loader.js";
import ChsDevConfig from "../model/Config.js";
import State from "../model/State.js";
import { DockerCompose } from "../run/docker-compose.js";
import { ServiceLoader } from "../run/service-loader.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { MISSING_REPOSITORY, repositoryName, currentBranch } from "../helpers/service-repository.js";
import { join } from "path";
import { red } from "ansis";
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

        const branchCache = new Map<string, string>();
        const branchOf = (serviceName: string): string => {
            const service = this.inventory.services.find(s => s.name === serviceName);

            if (!service) {
                return "n/a";
            }

            const repository = repositoryName(service);

            if (!branchCache.has(repository)) {
                branchCache.set(
                    repository,
                    currentBranch(join(this.chsDevConfig.projectPath, "repositories", repository))
                );
            }

            return branchCache.get(repository)!;
        };

        const serviceLoader = new ServiceLoader(this.inventory);
        let enabledServiceNames = serviceLoader.loadServicesNames(state);

        const enabledOtelServiceNames = dockerComposeState
            ? this.otelGenerator.otelServiceNames.filter(serviceName => serviceName in dockerComposeState)
            : [];

        enabledServiceNames = [...enabledServiceNames, ...enabledOtelServiceNames].sort();

        if (flags.json) {
            const jsonRepresentation = this.constructJsonRepresentation(
                state, enabledServiceNames, serviceState, branchOf
            );

            this.logJson(jsonRepresentation);
        } else {
            this.humanReadableLog(state, serviceState, enabledServiceNames, branchOf);
        }
    }

    private constructJsonRepresentation (
        state: State,
        enabledServiceNames: string[],
        serviceState: (serviceName: string, colourise: boolean) => string,
        branchOf: (serviceName: string) => string
    ) {
        return {
            modules: [
                ...state.modules
            ],
            services: enabledServiceNames.map((serviceName: string) => ({
                name: serviceName,
                composeStatus: serviceState(serviceName, false).replaceAll(/[()]/g, ""),
                branch: branchOf(serviceName),
                liveUpdate: state.servicesWithLiveUpdate.includes(serviceName),
                transient: !state.services.includes(serviceName)
            }))
        };
    }

    private humanReadableLog (
        state: State,
        serviceState: (serviceName: string, colourise: boolean) => string,
        enabledServiceNames: string[],
        branchOf: (serviceName: string) => string
    ) {
        const branchLabel = (serviceName: string) => {
            const branch = branchOf(serviceName);
            return `[branch: ${branch === MISSING_REPOSITORY ? red(branch) : branch}]`;
        };
        const { modules, services, excludedServices } = state;
        this.log("Manually activated modules:");
        for (const module of modules) {
            this.log(` - ${module}`);
        }

        this.log("\nManually activated services:");
        for (const service of services) {
            this.log(` - ${service} ${serviceState(service, true)} ${branchLabel(service)}`);
        }

        this.log("\nAutomatically activated services:");
        enabledServiceNames = enabledServiceNames.filter(serviceName => !excludedServices.includes(serviceName));

        for (const serviceName of enabledServiceNames) {
            this.log(` - ${serviceName} ${serviceState(serviceName, true)} ${branchLabel(serviceName)} ${state.servicesWithLiveUpdate.includes(serviceName) ? "[LIVE UPDATE]" : ""}`);
        }

        this.log("\nManually deactivated services:");
        for (const file of excludedServices.sort() || []) {
            this.log(` - ${file}`);
        }
    }
}
