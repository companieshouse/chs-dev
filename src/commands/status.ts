import { Command, Config, Flags } from "@oclif/core";

import { statusColouriser } from "../helpers/colouriser.js";
import loadConfig from "../helpers/config-loader.js";
import ChsDevConfig from "../model/Config.js";
import Service from "../model/Service.js";
import State from "../model/State.js";
import { DockerCompose } from "../run/docker-compose.js";
import { ServiceLoader } from "../run/service-loader.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { MISSING_REPOSITORY, repositoryName, currentBranch, latestReleaseTag, tagInUse, findMissingRepositories, requiresRepository } from "../helpers/service-repository.js";
import { join } from "path";
import { red, yellow } from "ansis";
import { OtelGenerator } from "../generator/otel-generator.js";

/**
 * inUse: TAG docker compose uses for the images (latest when not set);
 * repository: latest release tag of the checked-out repository;
 * stale: the two differ, so the environment needs regenerating or the image
 * does not match the checkout.
 */
type ServiceTag = { inUse: string, repository: string, stale: boolean };

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

        const repositoryInfoOf = (lookup: (repositoryPath: string) => string | undefined) => {
            const cache = new Map<string, string | undefined>();

            return (serviceName: string): string => {
                const service = this.inventory.services.find(s => s.name === serviceName);

                if (!service || !requiresRepository(service)) {
                    return "n/a";
                }

                const repository = repositoryName(service);

                if (!cache.has(repository)) {
                    cache.set(repository, lookup(join(this.chsDevConfig.projectPath, "repositories", repository)));
                }

                return cache.get(repository) ?? "none";
            };
        };
        const branchOf = repositoryInfoOf(currentBranch);
        const repositoryTagOf = repositoryInfoOf(latestReleaseTag);
        const tagOf = (serviceName: string): ServiceTag => {
            const service = this.inventory.services.find(s => s.name === serviceName);

            if (!service || !requiresRepository(service)) {
                return { inUse: "n/a", repository: "n/a", stale: false };
            }

            const inUse = tagInUse(this.chsDevConfig.projectPath, service) ?? "latest";
            const repository = repositoryTagOf(serviceName);

            return { inUse, repository, stale: inUse !== repository && !(inUse === "latest" && repository === "none") };
        };

        const serviceLoader = new ServiceLoader(this.inventory);
        let enabledServiceNames = serviceLoader.loadServicesNames(state);

        const enabledOtelServiceNames = dockerComposeState
            ? this.otelGenerator.otelServiceNames.filter(serviceName => serviceName in dockerComposeState)
            : [];

        enabledServiceNames = [...enabledServiceNames, ...enabledOtelServiceNames].sort();

        const activeServices = enabledServiceNames
            .map(name => this.inventory.services.find(s => s.name === name))
            .filter((service): service is Service => !!service)
            .filter(service => !state.excludedServices.includes(service.name));
        const missingRepositories = findMissingRepositories(this.chsDevConfig.projectPath, activeServices);

        if (flags.json) {
            const jsonRepresentation = {
                ...this.constructJsonRepresentation(
                    state, enabledServiceNames, serviceState, branchOf, tagOf
                ),
                missingRepositories
            };

            this.logJson(jsonRepresentation);
        } else {
            this.humanReadableLog(state, serviceState, enabledServiceNames, branchOf, tagOf, missingRepositories);
        }
    }

    private constructJsonRepresentation (
        state: State,
        enabledServiceNames: string[],
        serviceState: (serviceName: string, colourise: boolean) => string,
        branchOf: (serviceName: string) => string,
        tagOf: (serviceName: string) => ServiceTag
    ) {
        return {
            modules: [
                ...state.modules
            ],
            services: enabledServiceNames.map((serviceName: string) => ({
                name: serviceName,
                composeStatus: serviceState(serviceName, false).replaceAll(/[()]/g, ""),
                branch: branchOf(serviceName),
                tag: tagOf(serviceName).inUse,
                repositoryTag: tagOf(serviceName).repository,
                liveUpdate: state.servicesWithLiveUpdate.includes(serviceName),
                transient: !state.services.includes(serviceName)
            }))
        };
    }

    private humanReadableLog (
        state: State,
        serviceState: (serviceName: string, colourise: boolean) => string,
        enabledServiceNames: string[],
        branchOf: (serviceName: string) => string,
        tagOf: (serviceName: string) => ServiceTag,
        missingRepositories: Record<string, string[]>
    ) {
        const tagLabel = (serviceName: string) => {
            const { inUse, repository, stale } = tagOf(serviceName);
            return stale ? red(`[tag: ${inUse} (repository: ${repository})]`) : `[tag: ${inUse}]`;
        };
        const branchLabel = (serviceName: string) => {
            const branch = branchOf(serviceName);
            return `[branch: ${branch === MISSING_REPOSITORY ? red(branch) : branch}] ${tagLabel(serviceName)}`;
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

        const missing = Object.entries(missingRepositories);

        if (missing.length) {
            this.log(yellow(`\n⚠ Required repositories not cloned under repositories/ (docker compose cannot read their chs-dev.env):`));
            for (const [repository, names] of missing) {
                this.log(red(` - ${repository} (used by ${names.join(", ")})`));
            }
        }
    }
}
