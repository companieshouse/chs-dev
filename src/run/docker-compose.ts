import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { DockerComposeWatchLogHandler, LogHandler, PatternMatchingConsoleLogHandler } from "./logs-handler.js";

interface Logger {
    log: (msg: string) => void;
}

const CONTAINER_STOPPED_STATUS_PATTERN =
    /Container\s([\dA-Za-z-]*)\s*(Stopped|Removed)/;

const CONTAINER_STARTED_HEALTHY_STATUS_PATTERN =
    /Container\s([\dA-Za-z-]*)\s*(Started|Healthy|Stopped)/;

export class DockerCompose {

    private readonly logFile: string;

    constructor (private readonly path: string, private readonly logger: Logger) {
        const logsDir = join(this.path, "local/.logs");
        if (!existsSync(logsDir)) {
            mkdirSync(
                logsDir,
                {
                    recursive: true
                }
            );
        }

        this.logFile = join(logsDir,
            `compose.out.${Math.floor(Date.now() / 1000)}.txt`);
    }

    down (signal?: AbortSignal): Promise<void> {
        return this.dockerComposeAction(["down", "--remove-orphans"],
            this.createStatusMatchLogHandler(CONTAINER_STOPPED_STATUS_PATTERN),
            signal
        );
    }

    getServiceStatuses (): Record<string, string> | undefined {
        if (!existsSync(join(this.path, "docker-compose.yaml"))) {
            return undefined;
        }

        // Call docker compose and output the services and their status as a CSV
        // each service on an individual line
        const dockerComposePsOutput = execSync(
            "docker compose ps -a --format '{{.Service}},{{.Status}}' 2>/dev/null || : \"\"",
            { cwd: this.path }
        ).toString("utf-8");

        // Parse the compose output and load into a Record i.e. service name to
        // status
        return dockerComposePsOutput.length > 0
            ? Object.fromEntries(dockerComposePsOutput.split("\n")
                .map(line => line.split(",")))
            : undefined;
    }

    up (signal?: AbortSignal): Promise<void> {
        return this.dockerComposeAction(["up", "-d", "--remove-orphans"],
            this.createStatusMatchLogHandler(CONTAINER_STARTED_HEALTHY_STATUS_PATTERN),
            signal
        );
    }

    watch (signal?: AbortSignal): Promise<void> {
        return this.dockerComposeAction([
            "watch"
        ],
        new DockerComposeWatchLogHandler(this.logFile, this.logger),
        signal
        );
    }

    private dockerComposeAction (
        composeArgs: string[],
        logHandler: LogHandler,
        signal?: AbortSignal
    ): Promise<void> {
        const dataHandler = (data: string) => logHandler.handle(data);

        return this.runDockerCompose(composeArgs, dataHandler, signal);
    }

    private createStatusMatchLogHandler (pattern: RegExp) {
        return new PatternMatchingConsoleLogHandler(
            pattern, this.logFile, this.logger
        );
    }

    private runDockerCompose (composeArgs: string[], listener: (chunk: any) => void, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            // Spawn docker compose process
            const dockerComposeProcess = spawn(
                "docker",
                [
                    "compose",
                    ...composeArgs
                ],
                {
                    cwd: this.path,
                    // @ts-ignore
                    signal
                }
            );

            // Handle log statements to stdout and stderr
            dockerComposeProcess.stdout.on("data", listener);
            dockerComposeProcess.stderr.on("data", listener);

            // Handle exits and errors by resolving/rejecting the promise accordingly
            dockerComposeProcess.once("exit", (code: number, signal: string) => {
                if (code === 0 || code === 130) {
                    resolve();
                } else {
                    reject(new Error(`Docker compose up exited with code: ${code}`));
                }
            });

            dockerComposeProcess.once("error", (err: Error) => {
                reject(err);
            });
        });
    }
}
