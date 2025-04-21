import { greenBright, grey, red, redBright, yellowBright } from "ansis";
import { LogHandler, Logger } from "./logs-handler.js";
import stripAnsi from "strip-ansi";

/**
 * Handles log entries for development watch logs, parsing and logging
 * specific events such as service start, restart, exit, and crash.
 */
export class DevelopmentWatchLogNodeHandler implements LogHandler {
    // Regular expressions for matching log patterns
    private static readonly RESTART_REGEX = /"?([\w-]+)"?\s+\|\s+.*Nodemon Restarting.../;
    private static readonly CRASHED_REGEX = /"?([\w-]+)"?\s+\|\s+.*Nodemon Crashed!/;
    private static readonly READY_REGEX = /"?([\w-]+)"?\s+\|\s+.*Application Ready\./;
    private static readonly BUILT_STATUS_REGEX = /"?([\w-]+)"?\s+.*exited with code 0/;
    private static readonly NPM_INSTALL_COMPLETE_REGEX = /"?([\w-]+)"?\s+\|\s+.*npm install commencing\./;
    private static readonly NPM_INSTALL_FAILED_REGEX = /"?([\w-]+)"?\s+\|\s+.*npm install failed!\./;
    // npm install complete. Running Build. add for builds

    /**
     * Constructor to initialize the logger.
     * @param logger - Logger instance for logging messages.
     */
    // eslint-disable-next-line no-useless-constructor
    constructor (private readonly logger: Logger) {}

    /**
     * Handles log entries by parsing and logging specific events.
     * @param logEntries - Raw log entries as a string.
     */
    handle (logEntries: string): void {
        for (const logEntry of logEntries.toString().split("\n")) {
            if (!logEntry) continue;

            // Match and log service install events
            this.matchAndLog(
                logEntry,
                DevelopmentWatchLogNodeHandler.NPM_INSTALL_COMPLETE_REGEX,
                (serviceName) => this.logger.log(grey(`Service: ${serviceName} installing dependencies!`))
            );

            // Match and log service install events failed
            this.matchAndLog(
                logEntry,
                DevelopmentWatchLogNodeHandler.NPM_INSTALL_FAILED_REGEX,
                (serviceName) => this.logger.log(red(`Service: ${serviceName} installing dependencies failed!`))
            );

            // Match and log service ready events
            this.matchAndLog(
                logEntry,
                DevelopmentWatchLogNodeHandler.READY_REGEX,
                (serviceName) => this.logger.log(greenBright(`Service: ${serviceName} ready!`))
            );

            // Match and log service restart events
            this.matchAndLog(
                logEntry,
                DevelopmentWatchLogNodeHandler.RESTART_REGEX,
                (serviceName) => this.logger.log(yellowBright(`Nodemon: ${serviceName} restarting...`))
            );

            // Match and log service crash events
            this.matchAndLog(
                logEntry,
                DevelopmentWatchLogNodeHandler.CRASHED_REGEX,
                (serviceName) => this.logger.log(redBright(`Nodemon: ${serviceName} crashed!`))
            );

            // Match and log service reload events
            this.matchAndLog(
                logEntry,
                DevelopmentWatchLogNodeHandler.BUILT_STATUS_REGEX,
                (serviceName) => this.logger.log(greenBright(`Service: ${serviceName} reloaded!`))
            );
        }
    }

    /**
     * Matches a log entry against a regex and executes a callback if matched.
     * @param logEntry - The log entry to match.
     * @param regex - The regular expression to match against.
     * @param callback - The callback to execute if a match is found.
     */
    private matchAndLog (
        logEntry: string,
        regex: RegExp,
        callback: (serviceName: string) => void
    ): void {
        const cleanLog = this.cleanLogString(logEntry);
        const match = cleanLog.match(regex);
        if (match) {
            const [, serviceName] = match;
            callback(serviceName);
        }
    }

    private cleanLogString (str: string) {
        // eslint-disable-next-line no-control-regex
        return stripAnsi(str).replace(/[\x00-\x1F\x7F]/g, "");
    }

}

export default DevelopmentWatchLogNodeHandler;
