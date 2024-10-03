import { AbstractLogHandler, Logger, LogHandler } from "./logs-handler.js";

export class LogNothingLogHandler extends AbstractLogHandler {
    protected logToConsole (_: string[]): void { }

}

export default LogNothingLogHandler;
