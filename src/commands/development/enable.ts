import { join, relative } from "path";
import { existsSync } from "fs";
import { cli } from "cli-ux";
import { Service } from "../../model/Service.js";
import simpleGit from "simple-git";
import AbstractDevelopmentServiceCommand from "./AbstractDevelopmentServiceCommand.js";

export default class Enable extends AbstractDevelopmentServiceCommand {
    static description: string = "Adds a service to development mode";

    protected static action: string = "enable";

    protected async handleValidService (serviceName: string): Promise<boolean> {
        this.enableService(serviceName);

        await this.config.runHook("generate-development-docker-compose", { serviceName });

        await this.cloneServiceRepository(serviceName);

        return true;
    }

    private enableService (serviceName: string) {
        this.stateManager.includeServiceInLiveUpdate(serviceName);
        this.log(`Service "${serviceName}" is enabled`);
    }

    private async cloneServiceRepository (serviceName: string): Promise<void> {
        const service = this.inventory.services.find(item => item.name === serviceName) as Service;

        const localPath = join(process.cwd(), "repositories", service.name);
        if (!existsSync(localPath)) {
            cli.action.start(`Cloning ${service.repository!.branch || "default"} branch of ${service.repository!.url} repository to ${relative(process.cwd(), localPath)} directory`);
            // @ts-ignore
            const git = simpleGit();

            await git.clone(service.repository!.url, localPath, service.repository?.branch ? ["--branch", service.repository.branch] : []);
            cli.action.stop("done");
        }
    }

}
