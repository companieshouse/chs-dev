import { LogHandler } from "./logs-handler.js";

/**
 * Captures process output without displaying the secret being retrieved.
 */
export class LogCapturingLogHandler implements LogHandler {
    private readonly logs: string[] = [];

    handle (logEntry: string): void {
        this.logs.push(logEntry.toString());
    }

    getLogs (): string[] {
        return this.logs;
    }
}
