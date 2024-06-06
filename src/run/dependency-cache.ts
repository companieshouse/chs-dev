import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export class DependencyCache {

    constructor (private readonly path: string) {
        const m2CachePath = join(path, "local/.m2");

        if (!existsSync(m2CachePath)) {
            mkdirSync(m2CachePath, { recursive: true });
        }
    }

    update (): void {
        execSync(
            `rsync -au "\${HOME}"/.m2/repository/uk/ "${this.path}"/local/.m2/uk/`
        );
    }
}
