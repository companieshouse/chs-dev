import { join, relative } from "path";
import { existsSync } from "fs";
import { ux, Args, Config } from "@oclif/core";
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

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error, true);
        this.validArgumentHandler = this.handleValidService;
    }

    private async handleValidService (serviceName: string): Promise<void> {
        this.enableService(serviceName);

        await this.config.runHook("generate-development-docker-compose", { serviceName });

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

            await git.clone(service.repository!.url, localPath, service.repository?.branch ? ["--branch", service.repository.branch] : []);
            ux.action.stop("done");
        }
    }

}
