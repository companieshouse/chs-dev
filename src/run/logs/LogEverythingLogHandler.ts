import { LogHandler, Logger } from "./logs-handler.js";

export class LogEverythingLogHandler implements LogHandler {

    private logLineFormatter: (logLine: string) => string = (logLine) => logLine;

    constructor (private readonly logger: Logger, readonly prefix?: string) {
        if (prefix && prefix !== "") {
            this.logLineFormatter = logLine => `${prefix}${logLine}`;
        }
    }

    handle (logEntry: string): void {
        for (const logLine of logEntry.toString().split("\n")) {
            if (logLine) {
                this.logger.log(this.logLineFormatter(logLine));
            }
        }
    }
}
