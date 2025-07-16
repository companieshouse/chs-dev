import { Args, Config, Flags } from "@oclif/core";
import { serviceValidator } from "../../helpers/validator.js";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";

export default class Add extends AbstractStateModificationCommand {
    static description = "Adds a new service to the exclusions list";
    static aliases = ["exclude"];

    static args = {
        service: Args.string({
            name: "excluded-service",
            required: true,
            description: "name of service being excluded from the docker environment"
        })
    };

    static flags = {
        dependency: Flags.boolean({
            name: "dependency",
            char: "d",
            aliases: ["dependency"],
            default: false,
            description: "Add services dependencies to the exclusion list."
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");
        this.preHookCheckWarnings = this.handlePreHookCheck;
        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error);
        this.validArgumentHandler = this.handleValidService;
    }

    protected override parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(Add);
    }

    private async handlePreHookCheck (commandArgv: string[]): Promise<string | undefined> {
        return await this.handleServiceModuleStateHook({ topic: "exclusions", commandArgv });
    }

    private async handleValidService (serviceName: string): Promise<void> {
        const dependency = this.flagValues?.dependency || false;
        const logs: string[] = [];

        if (dependency) {
            logs.push(...await this.handleDependencyExclusion(serviceName));
        }

        logs.push(this.handleExcludeAndLog(serviceName));
        logs.forEach(msg => this.log(msg));
    }

    /**
     * Handles exclusion of a service's direct dependencies.
     * Optimized for performance and readability.
     * @param serviceName Name of the service to exclude dependencies for
     * @returns Array of log messages
     */
    private async handleDependencyExclusion (serviceName: string): Promise<string[]> {
        const logs: string[] = [];
        const dependencies = this.serviceLoader.getServiceDirectDependencies(serviceName);

        if (dependencies.length > 0) {
            logs.push(`Adding "${serviceName}" and its dependencies to the exclusion list`);
            const logMessage: string[] = [];

            // Build activated service names and dependency map
            const activatedServiceNames = this.getActivatedServiceNames(serviceName);
            const dependencyMap = this.buildDependencyMap(activatedServiceNames, logMessage);

            // Exclude dependencies if not already dependent elsewhere
            logs.push(...this.excludeDependencies(dependencies, activatedServiceNames, dependencyMap, logMessage));

            if (logMessage.length > 0) {
                logs.push(...logMessage);
            }
        } else {
            logs.push(`No dependencies found for service "${serviceName}"`);
        }
        return logs;
    }

    /**
     * Returns activated service names excluding the current service and already excluded services.
     */
    private getActivatedServiceNames (serviceName: string): string[] {
        return this.serviceLoader
            .loadServicesNames(this.stateManager.snapshot)
            .filter(name => !this.stateManager.snapshot.excludedServices.includes(name) && name !== serviceName);
    }

    /**
     * Builds a map of service names to their direct dependencies.
     */
    private buildDependencyMap (serviceNames: string[], logMessage: string[]): Record<string, Set<string>> {
        const dependencyMap: Record<string, Set<string>> = {};
        for (const name of serviceNames) {
            try {
                dependencyMap[name] = new Set(this.serviceLoader.getServiceDirectDependencies(name));
            } catch (err) {
                logMessage.push(`Failed to parse docker compose for service "${name}": ${err}`);
            }
        }
        return dependencyMap;
    }

    /**
     * Excludes dependencies if not already dependent elsewhere and returns log messages.
     */
    private excludeDependencies (
        dependencies: string[],
        activatedServiceNames: string[],
        dependencyMap: Record<string, Set<string>>,
        logMessage: string[]
    ): string[] {
        const logs: string[] = [];
        for (const dep of dependencies) {
            if (this.isDependencyElsewhere(dep, activatedServiceNames, dependencyMap, logMessage)) {
                continue;
            }
            logs.push(this.handleExcludeAndLog(dep));
        }
        return logs;
    }

    /**
     * Checks if a dependency is also a direct dependency of another activated service.
     */
    private isDependencyElsewhere (
        dep: string,
        activatedServiceNames: string[],
        dependencyMap: Record<string, Set<string>>,
        logMessage: string[]
    ): boolean {
        for (const activatedService of activatedServiceNames) {
            if (dependencyMap[activatedService]?.has(dep)) {
                logMessage.push(this.handleDependencyMessages(activatedService, dep));
                return true;
            }
        }
        return false;
    }

    private handleExcludeAndLog (serviceName: string): string {
        this.stateManager.addExclusionForService(serviceName);
        return `Service "${serviceName}" is excluded`;
    }

    private handleDependencyMessages (serviceName: string, dependentService: string): string {
        return `Service "${dependentService}" is also a dependent service of "${serviceName}" and cannot be excluded`;
    }
}
