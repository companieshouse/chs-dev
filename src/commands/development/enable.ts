import { join, relative } from "path";
import { existsSync } from "fs";
import { ux, Args, Config, Flags } from "@oclif/core";
import { Service } from "../../model/Service.js";
import simpleGit from "simple-git";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";

export default class Enable extends AbstractStateModificationCommand {
    static description: string = "Adds a service to development mode";

    static args = {
        services: Args.string({
            name: "services",
            required: true,
            description: "names of services to be added to development mode"
        })
    };

    static flags = {
        builderVersion: Flags.string({
            name: "builder-version",
            char: "b",
            aliases: ["builderVersion"],
            description: "version of the builder to use with service",
            default: "latest"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");
        this.preHookCheckWarnings = this.handlePreHookCheck;

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error, true);
        this.validArgumentHandler = this.handleValidService;
    }

    protected override parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(Enable);
    }

    private async handlePreHookCheck (commandArgv: string[]): Promise<string|undefined> {
        return await this.handleServiceModuleStateHook({ topic: "development", commandArgv });
    }

    private async handleValidService (serviceName: string): Promise<void> {
        this.enableService(serviceName);

        const versionFlagValue: string = this.flagValues?.builderVersion || "latest";

        const hookOptions: Record<string, string> = { serviceName };

        if (versionFlagValue.toLowerCase() !== "latest") {
            hookOptions.builderVersion = versionFlagValue.startsWith("v")
                ? versionFlagValue
                : `v${versionFlagValue}`;
        }

        await this.config.runHook("generate-development-docker-compose", hookOptions);

        await this.cloneServiceRepository(serviceName);
    }

    private enableService (serviceName: string) {
        this.stateManager.includeServiceInLiveUpdate(serviceName);
        this.log(`Service "${serviceName}" is enabled`);
    }

    private async cloneServiceRepository (serviceName: string): Promise<void> {
        const service = this.inventory.services.find(item => item.name === serviceName) as Service;

        const localPath = join(this.chsDevConfig.projectPath, "repositories", service.name);
        if (!existsSync(localPath)) {
            ux.action.start(`Cloning ${service.repository!.branch || "default"} branch of ${service.repository!.url} repository to ${relative(this.chsDevConfig.projectPath, localPath)} directory`);
            // @ts-ignore
            const git = simpleGit();

            await git.clone(service.repository!.url.trim(), localPath, service.repository?.branch ? ["--branch", service.repository.branch] : []);
            ux.action.stop("done");
        }
    }

}
