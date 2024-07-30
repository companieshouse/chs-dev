import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Represents local dependencies of software components (i.e. Maven artifacts)
 * cached for speedier builds.
 */
export class DependencyCache {

    constructor (private readonly path: string) {
        const m2CachePath = join(path, "local/.m2");

        if (!existsSync(m2CachePath)) {
            mkdirSync(m2CachePath, { recursive: true });
        }
    }

    /**
     * Updates/creates the dependency cache. If there are no cached artifacts
     * and the cache does not exist, it creates an empty cache.
     */
    update (): void {
        const sourceDirectory = ".m2/repository/uk";
        const destinationDirectory = join(this.path, "local/.m2/uk/");

        if (existsSync(join(homedir(), sourceDirectory))) {
            execSync(
                `rsync -au "\${HOME}"/.m2/repository/uk/ "${destinationDirectory}"`
            );
        } else if (!existsSync(destinationDirectory)) {
            mkdirSync(
                destinationDirectory,
                {
                    recursive: true
                }
            );
        }
    }
}
