import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export class DependencyCache {

    constructor (private readonly path: string) {
        if (!existsSync(join(path, "local/.m2"))) {
            mkdirSync("local/.m2", { recursive: true });
        }
    }

    update (): void {
        execSync(
            `rsync -au "\${HOME}"/.m2/repository/uk/ "${this.path}"/local/.m2/uk/`
        );
    }
}
