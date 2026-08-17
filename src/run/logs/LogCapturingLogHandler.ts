import { LogHandler } from "./logs-handler.js";

export class LogCapturingLogHandler implements LogHandler {
    private logs: string[] = [];

    handle (logEntry: string): void {
        this.logs.push(logEntry);
    }

    getLogs (): string[] {
        return [...this.logs];
    }
}
