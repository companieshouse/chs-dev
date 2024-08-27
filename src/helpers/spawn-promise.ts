import childProcess, { SpawnOptions } from "child_process";
import { LogHandler } from "../run/logs/logs-handler.js";

export type SpawnPromiseOptions = {
    logHandler: LogHandler;

    stderrLogHandler?: LogHandler;

    spawnOptions?: SpawnOptions;

    acceptableExitCodes?: number[];
}

/**
 * Runs spawn process within a Promise and attaches the supplied log handlers
 * to the appropriate streams.
 * @param command: string - executable to spawn
 * @param args: string[] - list of arguments to pass to the executable
 * @param options: SpawnPromiseOptions - Configuration providing extra
 *          properties to the function
 * @returns promise detailing the result of the spawned process. If the
 *          exit code equals one of the ones provided in `acceptableExitCodes`
 *          then resolves otherwise will reject.
 */
export const spawn = (
    command: string,
    args: string[],
    {
        logHandler,
        spawnOptions,
        stderrLogHandler,
        acceptableExitCodes
    }: SpawnPromiseOptions
): Promise<void> => {
    if (!stderrLogHandler) {
        stderrLogHandler = logHandler;
    }

    if (!acceptableExitCodes) {
        acceptableExitCodes = [0];
    }

    return new Promise((resolve, reject) => {
        const process = childProcess.spawn(
            command,
            args,
            spawnOptions || {}
        );

        if (process.stdout !== null) {
            process.stdout.on("data", data => logHandler.handle(data));
        }

        if (process.stderr !== null) {
            process.stderr.on("data", data => stderrLogHandler.handle(data));
        }

        process.once("exit", (code: number) => {
            if (acceptableExitCodes.includes(code)) {
                return resolve();
            }

            return reject(code);
        });

        process.once("error", (error) => {
            reject(error);
        });
    });
};
