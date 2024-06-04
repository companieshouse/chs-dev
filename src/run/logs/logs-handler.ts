import { writeFileSync } from "fs";

export interface Logger {
    log(msg: string): void
}

export interface LogHandler {
    handle(logEntry: string): void
}

export abstract class AbstractLogHandler implements LogHandler {

    protected readonly verbose: boolean;

    constructor (protected readonly logFile: string, protected readonly logger: Logger) {
        this.verbose = "CHS_DEV_VERBOSE" in process.env;
    };

    handle (logEntry: string): void {
        const logEntries = this.formatLogLines(logEntry);

        this.writeToFile(logEntries);

        this.logToConsole(logEntries);
    }

    protected abstract logToConsole(logEntries: string[]): void

    private writeToFile (logEntries: string[]) {
        writeFileSync(
            this.logFile,
            logEntries.join(),
            {
                flag: "a"
            }
        );
    }

    private formatLogLines (logEntry: string): string[] {
        return logEntry.toString().trim().split("\n")
            .map((line: string) => `${new Date().toISOString()} - ${line.trim()}\n`);
    }
}
