import { AbstractLogHandler, Logger } from "./logs-handler.js";

export default class PatternMatchingConsoleLogHandler extends AbstractLogHandler {

    constructor (private readonly pattern: RegExp, readonly logFile: string, readonly logger: Logger) {
        super(logFile, logger);
    }

    protected logToConsole (logEntry: string[]): void {
        const { logger, verbose } = this;

        logEntry
            .forEach((logEntry) => {
                const matches = logEntry.match(this.pattern);

                if (matches) {
                    const [_, serviceName, serviceStatus] = matches;
                    logger.log(`Service ${serviceName} ${serviceStatus}`);
                } else if (verbose) {
                    logger.log(logEntry);
                }
            });
    }
}
