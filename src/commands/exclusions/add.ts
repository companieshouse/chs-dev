import { Args, Config, Flags } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";
import { ServiceLoader } from "../../run/service-loader.js";
import { read, readFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import { DockerComposeSpec } from "../../model/DockerComposeSpec.js";

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

        logs.push(this.excludeAndLog(serviceName));
        logs.forEach(msg => this.log(msg));
    }

    private async handleDependencyExclusion (serviceName: string): Promise<string[]> {
        const logs: string[] = [];
        const dependencies = this.inventory.getServiceDirectDependencies(serviceName);

        if (dependencies.length > 0) {
            logs.push(`Adding "${serviceName}" and its dependencies to the exclusion list`);
            const alreadyDependent: string[] = [];

            for (const dep of dependencies) {
                if (this.isDependentServiceADependentInAnotherService(serviceName, dep, alreadyDependent)) {
                    continue;
                }
                logs.push(this.excludeAndLog(dep));
            }

            if (alreadyDependent.length > 0) {
                logs.push(...alreadyDependent);
            }
        } else {
            logs.push(`No dependencies found for service "${serviceName}"`);
        }
        return logs;
    }

    private isDependentServiceADependentInAnotherService (
        parentServiceName: string,
        dependentServiceName: string,
        alreadyDependent: string[]
    ): boolean {
        const serviceLoader = new ServiceLoader(this.inventory);
        const enabledServiceNames = serviceLoader
            .loadServicesNames(this.stateManager.snapshot)
            .filter(name => !this.stateManager.snapshot.excludedServices.includes(name));

        for (const enabledService of enabledServiceNames) {
            if (
                enabledService === parentServiceName ||
                enabledService === dependentServiceName
            ) {
                continue;
            }

            try {
                if (this.inventory.getServiceDirectDependencies(enabledService).includes(dependentServiceName)) {
                    alreadyDependent.push(this.handleDependencyMessages(enabledService, dependentServiceName));
                    return true;
                }
            } catch (err) {
                alreadyDependent.push(`Failed to parse docker compose for service "${enabledService}": ${err}`);
            }
        }
        return false;
    }

    private excludeAndLog (serviceName: string): string {
        this.stateManager.addExclusionForService(serviceName);
        return `Service "${serviceName}" is excluded`;
    }

    private handleDependencyMessages (serviceName: string, dependentService: string): string {
        return `Service "${dependentService}" is also a dependent service of "${serviceName}" and cannot be excluded`;
    }
}
