import { LogHandler } from "./logs-handler.js";

/**
 * A {@link LogHandler} implementation which captures log entries in memory instead of
 * writing them out, allowing the output of a spawned process to be inspected afterwards.
 */
export class LogCapturingLogHandler implements LogHandler {
    private logs: string[] = [];

    /**
     * Captures a log entry, appending it to the in-memory list of logs.
     * @param {string} logEntry - The log entry to capture.
     */
    handle (logEntry: string): void {
        this.logs.push(logEntry);
    }

    /**
     * Returns a copy of all log entries captured so far.
     * @returns { string[] } - The captured log entries, in the order they were received.
     */
    getLogs (): string[] {
        return [...this.logs];
    }
}
