import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { ux } from "@oclif/core";

import { DockerCompose } from "./docker-compose.js";

type Prompter = (prompt: string) => Promise<boolean>

export class DevelopmentMode {

    private readonly lockFile: string;

    constructor (private readonly dockerCompose: DockerCompose, private readonly path: string) {
        this.lockFile = join(this.path, "local/.watch");
    }

    async start (prompter?: Prompter): Promise<void> {
        if (this.lockExists()) {
            throw new Error("ERROR! There are services running in development mode. Stop other development mode processes and try again.");
        }

        this.acquireLock();

        const controller = new AbortController();
        const { signal } = controller;

        // eslint-disable-next-line no-async-promise-executor
        return new Promise((resolve, reject) => {
            process.once("SIGINT", () => {
                this.sigintHandler(controller, prompter)
                    .then(resolve)
                    .catch(reject);
            });

            return this.dockerCompose.watch(signal).catch((err) => {
                this.releaseLock();
                reject(err);
            });
        });
    }

    protected sigintHandler (controller: AbortController, prompter?: Prompter): Promise<void> {
        this.releaseLock();

        ux.action.stop();

        const stopEnvironment = prompter
            ? prompter("Do you want to stop running your local docker environment?")
            : Promise.resolve(true);

        return stopEnvironment.then((stop) => {

            ux.action.start("Stopping chs-dev environment");
            if (stop) {
                return this.dockerCompose.down({
                    removeVolumes: false,
                    removeImages: false
                });
            }
        })
            .then(() => controller.abort());
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
