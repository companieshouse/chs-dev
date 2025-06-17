import { greenBright, grey, red, redBright, yellowBright } from "ansis";
import { LogHandler, Logger } from "./logs-handler.js";
import stripAnsi from "strip-ansi";

/**
 * Handles log entries for development watch logs, parsing and logging
 * specific events such as service ready, healthy, restart, and crash.
 */
export class DevelopmentWatchLogNodeHandler implements LogHandler {
    // Regular expressions for matching log patterns
    private static readonly LOG_PATTERNS = {
        RESTART: /"?([\w-]+)"?\s+\|\s+.*Nodemon Restarting.../,
        CRASHED: /"?([\w-]+)"?\s+\|\s+.*Nodemon Crashed!/,
        READY: /"?([\w-]+)"?\s+\|\s+.*Application Ready\./,
        HEALTHY_STATUS: /Container\s+([\w-]+)\s+healthy/,
        UNHEALTHY_STATUS: /Container\s+([\w-]+)\s+unhealthy/,
        NPM_INSTALL_COMPLETE: /"?([\w-]+)"?\s+\|\s+.*npm install commencing\./,
        NPM_INSTALL_FAILED: /"?([\w-]+)"?\s+\|\s+.*npm install failed!\./
    };

    private static readonly LOG_ACTIONS = {
        READY: (logger: Logger, serviceName: string, timestamp: string) =>
            logger.log(greenBright(`${timestamp} - Service: ${serviceName} ready!`)),
        HEALTHY_STATUS: (logger: Logger, serviceName: string, timestamp: string) =>
            logger.log(greenBright(`${timestamp} - Service: ${serviceName} ready!`)),
        RESTART: (logger: Logger, serviceName: string, timestamp: string) =>
            logger.log(yellowBright(`${timestamp} - Nodemon: ${serviceName} restarting...`)),
        CRASHED: (logger: Logger, serviceName: string, timestamp: string) =>
            logger.log(redBright(`${timestamp} - Nodemon: ${serviceName} crashed!`)),
        NPM_INSTALL_COMPLETE: (
            logger: Logger,
            serviceName: string,
            timestamp: string
        ) =>
            logger.log(
                grey(`${timestamp} - Service: ${serviceName} installing dependencies!`)
            ),
        NPM_INSTALL_FAILED: (
            logger: Logger,
            serviceName: string,
            timestamp: string
        ) =>
            logger.log(
                red(`${timestamp} - Service: ${serviceName} installing dependencies failed!`)
            ),
        UNHEALTHY_STATUS: (
            logger: Logger,
            serviceName: string,
            timestamp: string
        ) =>
            logger.log(redBright(`${timestamp} - Service: ${serviceName} crashed!`))
    };

    // eslint-disable-next-line no-useless-constructor
    constructor (private readonly logger: Logger) {}

    /**
   * Handles log entries by parsing and logging specific events.
   * @param logEntries - Raw log entries as a string.
   */
    handle (logEntries: string): void {
        for (const logEntry of logEntries.toString().split("\n")) {
            if (!logEntry) continue;

            const cleanLog = this.cleanLogString(logEntry);

            for (const [key, regex] of Object.entries(
                DevelopmentWatchLogNodeHandler.LOG_PATTERNS
            )) {
                const match = cleanLog.match(regex);
                if (match) {
                    const [, serviceName] = match;
                    const action =
            DevelopmentWatchLogNodeHandler.LOG_ACTIONS[
              key as keyof typeof DevelopmentWatchLogNodeHandler.LOG_ACTIONS
            ];
                    const timestamp = new Date().toISOString();
                    action(this.logger, serviceName, timestamp);
                    break;
                }
            }
        }
    }

    /**
   * Cleans a log string by removing ANSI escape codes and control characters.
   * @param str - The log string to clean.
   * @returns The cleaned log string.
   */
    private cleanLogString (str: string): string {
    // eslint-disable-next-line no-control-regex
        return stripAnsi(str).replace(/[\x00-\x1F\x7F]/g, "");
    }
}

export default DevelopmentWatchLogNodeHandler;
