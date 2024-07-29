import { existsSync, readFileSync } from "fs";
import Config from "../model/Config.js";
import { Inventory } from "./inventory.js";
import { join } from "path";
import yaml from "yaml";
import { cloneRepo, updateRepo } from "../helpers/git.js";
import Service from "../model/Service.js";

/**
 * Manages the state of the repositories which are permanent - i.e. required
 * to run the service.
 */
export class PermanentRepositories {

    // eslint-disable-next-line no-useless-constructor
    constructor (private readonly config: Config, private readonly inventory: Inventory) {}

    /**
     * Ensures that repositories exist and are up to date for each of the
     * services which require a copy of a local repository. When no services
     * have been enabled (i.e. docker compose spec file is missing) then it
     * will error.
     * @returns Promise based on the outcome of the action
     */
    async ensureAllExistAndAreUpToDate (): Promise<void> {

        const dockerComposeSpecFile = join(this.config.projectPath, "docker-compose.yaml");

        if (!existsSync(dockerComposeSpecFile)) {
            throw new Error(
                "No services enabled - could not find docker compose spec file. Enable a service and try again"
            );
        }

        const dockerComposeSpec = yaml.parse(readFileSync(dockerComposeSpecFile).toString("utf8"));

        for (const includedSpecFile of dockerComposeSpec.include) {
            const service = this.findServiceWithSource(includedSpecFile);

            if (service) {
                console.log(`Updating ${service.name}`);

                const localRepoPath = join(this.config.projectPath, "repositories", service.name);

                if (!existsSync(localRepoPath)) {
                    await this.cloneServiceRepo(service, localRepoPath);

                    continue;
                }

                await updateRepo(localRepoPath);
            }
        }
    }

    private findServiceWithSource (includedSpecFile: any) {
        return this.inventory.services.find(({ source, metadata }) => source === includedSpecFile && metadata.repositoryRequired === "true");
    }

    private cloneServiceRepo (service: Service, localRepoPath: string) {
        if (service.repository) {
            return cloneRepo({
                repositoryUrl: service.repository.url,
                destinationPath: localRepoPath,
                branch: service.repository.branch
            });
        } else {
            throw new Error(`Service: ${service.name} has not been configured with a repository`);
        }
    }
}
