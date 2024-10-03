import { existsSync } from "fs";
import Config from "../model/Config.js";
import { join } from "path";
import { spawn } from "../helpers/spawn-promise.js";
import LogEverythingLogHandler from "./logs/LogEverythingLogHandler.js";
import { Logger } from "./logs/logs-handler.js";

export class DockerEcrLogin {

    // eslint-disable-next-line no-useless-constructor
    constructor (private readonly chsDevInstallDirectory: string, private readonly logger: Logger) { }

    attemptLoginToDockerEcr (): Promise<void> {
        const awsConfigurationFile = join(process.env.HOME as string, ".aws/config");

        if (!existsSync(awsConfigurationFile)) {
            return Promise.reject(new Error("Does not look like AWS has been configured"));
        }

        return spawn(
            // "/bin/bash",
            join(this.chsDevInstallDirectory, "bin/docker_login.sh"),
            [],
            {
                logHandler: new LogEverythingLogHandler(this.logger),
                spawnOptions: {
                    shell: "/bin/bash"
                }
            }
        );
    }
}
