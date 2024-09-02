import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { LogHandler } from "./logs/logs-handler.js";
import DockerComposeWatchLogHandler from "./logs/DockerComposeWatchLogHandler.js";
import PatternMatchingConsoleLogHandler from "./logs/PatternMatchingConsoleLogHandler.js";
import Config from "../model/Config.js";
import LogEverythingLogHandler from "./logs/LogEverythingLogHandler.js";
import { spawn } from "../helpers/spawn-promise.js";
import { runStatusColouriser, stopStatusColouriser } from "../helpers/colouriser.js";

interface Logger {
    log: (msg: string) => void;
}

const CONTAINER_STOPPED_STATUS_PATTERN =
    /Container\s([\dA-Za-z-]+)\s*(Stopped|Removed)/;

const CONTAINER_STARTED_HEALTHY_STATUS_PATTERN =
    /(?:Container\s)?([\dA-Za-z-]+)\s*(Started|Healthy|Stopped|Pulling|Pulled)/;

type LogsArgs = {
    serviceNames: string[] | undefined,
    tail: string | undefined,
    follow: boolean | undefined,
    signal: AbortSignal | undefined
}

export class DockerCompose {

    readonly logFile: string;

    constructor (readonly config: Config, readonly logger: Logger) {
        const logsDir = join(this.config.projectPath, "local/.logs");
        if (!existsSync(logsDir)) {
            mkdirSync(
                logsDir,
                {
                    recursive: true
                }
            );
        }

        const date = new Date(Date.now());

        this.logFile = join(logsDir,
            `compose.out.${date.getFullYear()}-${date.getMonth()}-${date.getDay()}.txt`);
    }

    down (options?: {
        removeVolumes?: boolean,
        removeImages?: boolean
    }, signal?: AbortSignal): Promise<void> {
        const dockerComposeArgs = [
            "down",
            "--remove-orphans",
            ...(options?.removeVolumes ? ["--volumes"] : []),
            ...(options?.removeImages ? ["--rmi", "local"] : [])
        ];

        return this.runDockerCompose(dockerComposeArgs,
            this.createStatusMatchLogHandler(CONTAINER_STOPPED_STATUS_PATTERN, stopStatusColouriser),
            signal
        );
    }

    getServiceStatuses (): Record<string, string> | undefined {
        if (!existsSync(join(this.config.projectPath, "docker-compose.yaml"))) {
            return undefined;
        }

        // Call docker compose and output the services and their status as a CSV
        // each service on an individual line
        const dockerComposePsOutput = execSync(
            "docker compose ps -a --format '{{.Service}},{{.Status}}' 2>/dev/null || : \"\"",
            { cwd: this.config.projectPath }
        ).toString("utf-8");

        // Parse the compose output and load into a Record i.e. service name to
        // status
        return dockerComposePsOutput.length > 0
            ? Object.fromEntries(dockerComposePsOutput.split("\n")
                .map(line => line.split(",")))
            : undefined;
    }

    up (signal?: AbortSignal): Promise<void> {
        return this.runDockerCompose(["up", "-d", "--remove-orphans"],
            this.createStatusMatchLogHandler(CONTAINER_STARTED_HEALTHY_STATUS_PATTERN, runStatusColouriser),
            signal
        );
    }

    watch (signal?: AbortSignal): Promise<void> {
        return this.runDockerCompose([
            "watch"
        ],
        new DockerComposeWatchLogHandler(this.logFile, this.logger),
        signal
        );
    }

    logs ({ serviceNames, signal, tail, follow }: LogsArgs): Promise<void> {
        return this.runDockerCompose([
            "logs",
            ...(tail && tail !== "all" ? ["--tail", tail] : []),
            ...(follow && follow === true ? ["--follow"] : []),
            ...(serviceNames && serviceNames.length > 0 ? ["--", ...serviceNames] : [])
        ], new LogEverythingLogHandler(this.logger),
        signal);
    }

    private createStatusMatchLogHandler (pattern: RegExp, colouriser?: (status: string) => string) {
        return new PatternMatchingConsoleLogHandler(
            pattern, this.logFile, this.logger, colouriser
        );
    }

    private async runDockerCompose (composeArgs: string[], logHandler: LogHandler, signal?: AbortSignal): Promise<void> {
        // Spawn docker compose process
        const dockerComposeEnv = this.config.env;
        const spawnOptions: {
            cwd: string,
            signal?: AbortSignal,
            env?: Record<string, string>
        } = {
            cwd: this.config.projectPath,
            signal
        };

        if (dockerComposeEnv && Object.keys(dockerComposeEnv).length > 0) {
            // @ts-expect-error
            spawnOptions.env = {
                ...(process.env),
                ...(dockerComposeEnv)
            };
        }

        try {
            await spawn(
                "docker",
                [
                    "compose",
                    ...composeArgs
                ],
                {
                    logHandler,
                    spawnOptions,
                    acceptableExitCodes: [0, 130]
                }
            );
        } catch (error) {
            throw new Error(`Docker compose failed with status code: ${error}`);
        }
    }

}
