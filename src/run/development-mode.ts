import { ux } from "@oclif/core";

import { DockerCompose } from "./docker-compose.js";
import { LogCoverage } from "../model/index.js";

type Prompter = (prompt: string) => Promise<boolean>
type WatchLogsArgs = { serviceNames, tail, follow }

export class DevelopmentMode {

    // eslint-disable-next-line no-useless-constructor
    constructor (
        private readonly dockerCompose: DockerCompose,
        private readonly logsArgs: WatchLogsArgs) { }

    async start (prompter: Prompter): Promise<void> {
        const controller = new AbortController();
        const { signal } = controller;

        return new Promise((resolve, reject) => {
            process.once("SIGINT", () => {
                this.sigintHandler(controller, prompter)
                    .then(resolve)
                    .catch(reject);
            });
            return this.dockerCompose.logs({ ...this.logsArgs, signal }, LogCoverage.WATCH).catch(reject);
        });
    }

    protected sigintHandler (controller: AbortController, prompter?: Prompter): Promise<void> {
        ux.action.stop();

        const stopEnvironment = prompter
            ? prompter("Do you want to stop running your local docker environment?")
            : Promise.resolve(true);

        return stopEnvironment.then((stop) => {
            if (stop) {
                ux.action.start("Stopping chs-dev environment");
                return this.dockerCompose.down({
                    removeVolumes: false,
                    removeImages: false
                });
            }
        })
            .then(() => controller.abort());
    }
}
