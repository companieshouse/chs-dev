import { AbstractLogHandler, Logger } from "./logs-handler.js";

export default class PatternMatchingConsoleLogHandler extends AbstractLogHandler {

    private readonly colouriser: ((status: string) => string) | undefined;

    constructor (private readonly pattern: RegExp, readonly logFile: string, readonly logger: Logger, colouriser?: (status: string) => string) {
        super(logFile, logger);
        this.colouriser = colouriser;
    }

    protected logToConsole (logEntry: string[]): void {
        const { logger, verbose } = this;

        logEntry
            .forEach((logEntry) => {
                const matches = logEntry.match(this.pattern);

                if (matches) {
                    const [_, serviceName, serviceStatus] = matches;
                    const colourisedStatus = this.colouriser ? this.colouriser(serviceStatus) : serviceStatus;
                    logger.log(`Service ${serviceName} ${colourisedStatus}`);
                } else if (verbose) {
                    logger.log(logEntry);
                }
            });
    }
}
