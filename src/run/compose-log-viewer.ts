import { join } from "path";
import Config from "../model/Config.js";
import glob from "glob";
import { LogEverythingLogHandler } from "./logs/LogEverythingLogHandler.js";
import { spawn } from "child_process";

export class ComposeLogViewer {

    // eslint-disable-next-line no-useless-constructor
    constructor (private readonly config: Config, private readonly logger: {
        log: (data: string) => void
    }) {}

    async view ({
        follow, tail
    }: {
        follow: boolean | undefined,
        tail: string | undefined
    }): Promise<void> {
        const logFiles = glob.sync(join(this.config.projectPath, "local/.logs/*.txt"));
        const stoutLogHandler = new LogEverythingLogHandler(this.logger);
        const stderrLogHandler = new LogEverythingLogHandler(this.logger, "ERROR:\t");

        if (logFiles.length === 0) {
            return Promise.reject(new Error("No log files found."));
        }

        const logFile = logFiles.sort().reverse()[0];

        const options: string[] = [];
        let command: string = "tail";

        if (tail && tail !== "all") {
            options.push("-n");
            options.push(tail);
        }

        if (follow) {
            options.push("-f");
        } else if (tail === "all") {
            command = "cat";
        }

        return new Promise((resolve, reject) => {
            const spawnedProcess = spawn(
                command,
                [...options, "--", logFile]
            );

            spawnedProcess.stdout.on("data", (chunk) => stoutLogHandler.handle(chunk));
            spawnedProcess.stderr.on("data", (chunk) => stderrLogHandler.handle(chunk));
            spawnedProcess.once("exit", (code) => {
                if (code === 0) {
                    return resolve();
                }
                return reject(new Error(`Process exited with exit code: ${code}`));
            });
            spawnedProcess.once("error", (err) => reject(err));
        });
    }
}
