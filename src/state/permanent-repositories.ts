import { existsSync, readFileSync } from "fs";
import Config from "../model/Config.js";
import { Inventory } from "./inventory.js";
import { join } from "path";
import yaml from "yaml";
import { cloneRepo, updateRepo } from "../helpers/git.js";
import { getIncludePath } from "../helpers/include-entry.js";
import { repositoryName, requiresRepository } from "../helpers/service-repository.js";
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

        const handled = new Set<string>();

        for (const includedSpecFile of dockerComposeSpec.include) {
            const sources = getIncludePath(includedSpecFile);

            for (const service of this.findServicesWithSource(sources)) {
                const repository = repositoryName(service);

                if (handled.has(repository)) {
                    continue;
                }
                handled.add(repository);

                const localRepoPath = join(this.config.projectPath, "repositories", repository);

                if (!existsSync(localRepoPath)) {
                    console.log(`Cloning ${repository} for ${service.name}`);
                    await this.cloneServiceRepo(service, localRepoPath);
                } else {
                    console.log(`Updating ${service.name}`);
                    try {
                        await updateRepo(localRepoPath);
                    } catch (error) {
                        console.warn(`Skipped updating ${repository}: ${(error as Error).message}`);
                    }
                }
            }
        }
    }

    /**
     * Services of the spec file which have a repository to be cloned/updated:
     * any non infrastructure service with a repository url
     */
    private findServicesWithSource (includedSpecFile: any) {
        return this.inventory.services.filter(service =>
            service.source === includedSpecFile &&
            requiresRepository(service) && !!service.repository?.url
        );
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
