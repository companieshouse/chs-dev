import { Args, Config, Flags } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";

export default class Remove extends AbstractStateModificationCommand {

    static description = "Removes an exclusion for a service.";

    static aliases = ["include"];

    static args = {
        service: Args.string({
            name: "excluded-service",
            required: true,
            description: "name of service being reincluded in the docker environment"
        })
    };

    static flags = {
        dependency: Flags.boolean({
            name: "dependency",
            char: "d",
            aliases: ["dependency"],
            default: false,
            description: "Remove service and its dependencies from the exclusion list."
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error);
        this.validArgumentHandler = this.handleValidService;
    }

    protected override parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(Remove);
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

    private async handleDependencyExclusion (serviceName: string): Promise<string[]> {
        const logs: string[] = [];
        const dependencies = this.serviceLoader.getServiceDirectDependencies(serviceName);

        if (dependencies.length > 0) {
            logs.push(`Removing"${serviceName}" and its dependencies from the exclusion list`);
            for (const dep of dependencies) {
                logs.push(this.handleExcludeAndLog(dep));
            }

        } else {
            logs.push(`No dependencies found for service "${serviceName}"`);
        }
        return logs;
    }

    private handleExcludeAndLog (serviceName: string): string {
        this.stateManager.removeExclusionForService(serviceName);
        return `Service "${serviceName}" is included (previous exclusion removed)`;
    }

}
