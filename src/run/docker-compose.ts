import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { runStatusColouriser, stopStatusColouriser } from "../helpers/colouriser.js";
import { spawn } from "../helpers/spawn-promise.js";
import Config from "../model/Config.js";
import DockerComposeWatchLogHandler from "./logs/DockerComposeWatchLogHandler.js";
import LogEverythingLogHandler from "./logs/LogEverythingLogHandler.js";
import LogNothingLogHandler from "./logs/LogNothingLogHandler.js";
import { LogHandler } from "./logs/logs-handler.js";
import PatternMatchingConsoleLogHandler from "./logs/PatternMatchingConsoleLogHandler.js";

interface Logger {
    log: (msg: string) => void;
}

type LogCoverage = "Watch" | "Log";
type Prune = "volume" | "network" | "image" | "container" | "builder";

const CONTAINER_STOPPED_STATUS_PATTERN =
    /Container\s([\dA-Za-z-]+)\s*(Stopped|Removed)/;

const CONTAINER_STARTED_HEALTHY_STATUS_PATTERN =
    /(?:Container\s)?([\dA-Za-z-]+)\s*(Started|Healthy|Stopped|Pulling|Pulled)/;

const AWS_PROFILE = process.env.AWS_PROFILE;
const INVALID_PROFILE_NAMES = ["undefined"];

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

        const dateLabel = date.toLocaleDateString(
            "en-CA", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        );

        this.logFile = join(logsDir, `compose.out.${dateLabel}.txt`);
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
        const execOptions = {
            cwd: this.config.projectPath,
            env: this.getAwsCredentials
        };
        const dockerComposePsOutput = execSync(
            "docker compose ps -a --format '{{.Service}},{{.Status}}' 2>/dev/null || : \"\"",
            execOptions
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

    async build (serviceName: string, regxPattern?: RegExp, signal?: AbortSignal): Promise<boolean | void> {
        const logHandler = regxPattern
            ? new PatternMatchingConsoleLogHandler(
                regxPattern, this.logFile, this.logger
            )
            : new LogNothingLogHandler(this.logFile, this.logger);

        await this.runDockerCompose(
            ["up", "--build", "--exit-code-from", serviceName, serviceName],
            logHandler,
            signal
        );
        return regxPattern ? (logHandler as { matchFoundByPattern: boolean }).matchFoundByPattern : undefined;
    }

    restart (serviceName: string, signal?: AbortSignal): Promise<void> {
        return this.runDockerCompose(["restart", serviceName],
            new LogNothingLogHandler(this.logFile, this.logger),
            signal
        );
    }

    logs (
        { serviceNames = [], signal, tail = "all", follow = false }: LogsArgs,
        coverage: LogCoverage = "Log"
    ): Promise<void> {
        const args = [
            "logs",
            ...(tail !== "all" ? ["--tail", tail] : []),
            ...(follow ? ["--follow"] : []),
            ...(serviceNames.length > 0 ? ["--", ...serviceNames] : [])
        ];

        const logHandler = coverage === "Log"
            ? new LogEverythingLogHandler(this.logger)
            : new DockerComposeWatchLogHandler(this.logger);

        return this.runDockerCompose(args, logHandler, signal);
    }

    healthCheck (serviceNames:string[]): void {
        const servicesNotReady: string[] = [];
        const serviceNamesToString = serviceNames.join(" ");
        const containersInspection = JSON.parse(execSync(`docker inspect ${serviceNamesToString}`).toString("utf8"));

        if (containersInspection.length > 0) {
            for (const container of containersInspection) {
                const containerName = container.Name.replace("/", "");
                const containerStatus = container.State.Health?.Status || "Unknown";

                if (containerStatus === "starting") {
                    servicesNotReady.push(containerName);
                }
                const logMessage = `Container ${containerName} ${containerStatus}`;
                const watch = new DockerComposeWatchLogHandler(this.logger).handle(logMessage);
            }
        }

        if (servicesNotReady.length > 0) {
            setTimeout(() => {
                this.healthCheck(servicesNotReady);
            }, 3000);
        }
    }

    pull (serviceName: string, abortSignal?: AbortSignal): Promise<void> {
        return this.runDockerCompose(
            [
                "pull",
                serviceName
            ],
            new LogNothingLogHandler(this.logFile, this.logger),
            abortSignal
        );
    }

    prune (commandArg: Prune): void {
        try {
            let logMsg: string;
            if (commandArg === "volume") {
                const volumes = execSync(`docker volume ls -qf dangling=true`, { encoding: "utf-8" });
                if (volumes.length === 0) {
                    return;
                }
                logMsg = execSync(`docker volume rm $(docker volume ls -qf dangling=true)`, { encoding: "utf-8" });
            } else {
                logMsg = execSync(`docker ${commandArg} prune -f`, { encoding: "utf-8" });
            }
            const log = new LogNothingLogHandler(logMsg, this.logger);
        } catch (error) {
            throw new Error(`Docker prune command failed: ${error}`);
        }
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
                ...process.env,
                ...dockerComposeEnv,
                ...this.getAwsCredentials
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

    private async runDockerCommands (commandArgs: string[], logHandler: LogHandler, signal?: AbortSignal): Promise<void> {
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
                ...process.env,
                ...dockerComposeEnv
            };
        }

        try {
            await spawn(
                "docker",
                [
                    ...commandArgs
                ],
                {
                    logHandler,
                    spawnOptions,
                    acceptableExitCodes: [0, 130]
                }
            );
        } catch (error) {
            throw new Error(`Docker command failed with status code: ${error}`);
        }
    }

    /**
     * Retrieves AWS credentials by executing the AWS CLI command and parsing the output.
     * @returns {Record<string, string>} An object containing AWS credentials.
     * @throws {Error} If the AWS CLI command fails or credentials cannot be retrieved.
    */
    private get getAwsCredentials (): Record<string, string> {
        if (!AWS_PROFILE || INVALID_PROFILE_NAMES.includes(AWS_PROFILE)) {
            throw new Error("Fetch AWS credentials failed: invalid profile detected. Run:'chs-dev troubleshoot analyse' command to troubleshoot.");
        }

        try {
            const output = execSync(`aws configure export-credentials --profile ${AWS_PROFILE} --format env`, { encoding: "utf-8" });

            return output
                .split("\n")
                .filter(line => line.startsWith("export "))
                .reduce((acc, line) => {
                    const [key, value] = line.replace("export ", "").split("=");
                    acc[key] = value;
                    return acc;
                }, {} as Record<string, string>);
        } catch (error: any) {
            const msg = error?.message || String(error);
            if (msg.includes("loading SSO Token") || msg.includes("retrieving token from sso")) {
                throw new Error(`Fetch AWS credentials failed. Run: aws sso login.`);
            }
            throw new Error(`Fetch AWS credentials failed. Run: 'chs-dev troubleshoot analyse' command to troubleshoot.`);
        }
    }

}
