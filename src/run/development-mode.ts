import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

import { DockerCompose } from "./docker-compose.js";

export class DevelopmentMode {

    private readonly lockFile: string;

    constructor (private readonly dockerCompose: DockerCompose, private readonly path: string) {
        this.lockFile = join(this.path, "local/.watch");
    }

    async start (prompter?: (prompt: string) => Promise<boolean>): Promise<void> {
        if (this.lockExists()) {
            throw new Error("ERROR! There are services running in development mode. Stop other development mode processes and try again.");
        }

        this.acquireLock();

        const self = this;

        const controller = new AbortController();
        const { signal } = controller;

        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            process.once("SIGINT", () => {

                self.releaseLock();

                const stopEnvironment = prompter
                    ? prompter("Do you want to stop running your local docker environment?")
                    : Promise.resolve(true);

                stopEnvironment.then((stop) => {
                    if (stop) {
                        return this.dockerCompose.down();
                    }
                })
                    .then(() => controller.abort())
                    .then(resolve)
                    .catch(reject);
            });

            try {
                return await this.dockerCompose.watch(signal);
            } catch (_) {
                self.releaseLock();
            }
        });
    }

    private acquireLock () {
        writeFileSync(
            this.lockFile,
            new Date().toISOString()
        );
    }

    private lockExists (): boolean {
        return existsSync(this.lockFile);
    }

    private releaseLock () {
        unlinkSync(this.lockFile);
    }
}
