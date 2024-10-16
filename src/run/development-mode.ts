import { ux } from "@oclif/core";

import { DockerCompose } from "./docker-compose.js";

type Prompter = (prompt: string) => Promise<boolean>

export class DevelopmentMode {

    // eslint-disable-next-line no-useless-constructor
    constructor (private readonly dockerCompose: DockerCompose) {}

    async start (prompter?: Prompter): Promise<void> {
        const controller = new AbortController();
        const { signal } = controller;

        // eslint-disable-next-line no-async-promise-executor
        return new Promise((resolve, reject) => {
            process.once("SIGINT", () => {
                this.sigintHandler(controller, prompter)
                    .then(resolve)
                    .catch(reject);
            });

            return this.dockerCompose.watch(signal).catch(reject);
        });
    }

    protected sigintHandler (controller: AbortController, prompter?: Prompter): Promise<void> {
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
}
