import { expect, jest } from "@jest/globals";
import fs from "fs";
import DockerComposeWatchLogHandler from "../../../src/run/logs/DockerComposeWatchLogHandler";
import { greenBright } from "ansis";

describe("DockerComposeWatchLogHandler", () => {
    const mockWriteFileSync = jest.spyOn(fs, "writeFileSync");
    const testTime = new Date(2024, 1, 2, 1, 1, 0);
    const logFile = "/tmp/log-file.txt";

    const spyNow = jest.spyOn(Date, "now");

    const mockLogger = {
        log: jest.fn()
    };

    let dockerComposeWatchLogHandler;

    beforeEach(() => {
        jest.resetAllMocks();
        dockerComposeWatchLogHandler = new DockerComposeWatchLogHandler(
            logFile, mockLogger
        );
        // @ts-expect-error This is creating a spied version and is valid
        spyNow.mockReturnValue(testTime);
    });

    beforeEach(async () => {
    });

    it("logs messages when ready (previous docker compose version)", () => {
        const logMessage = [
            "Watch configuration for service \"overseas-application\"",
            "- Action rebuild for path \"/do\""
        ].join("\n");

        dockerComposeWatchLogHandler.handle(logMessage);

        expect(mockLogger.log).toHaveBeenCalledWith(
            "Running services in development mode - watching for changes."
        );
        expect(mockLogger.log).toHaveBeenCalledTimes(3);
    });

    it("logs messages when ready", () => {
        const logMessage = [
            "Watch enabled"
        ].join("\n");

        dockerComposeWatchLogHandler.handle(logMessage);

        expect(mockLogger.log).toHaveBeenCalledWith(
            "Running services in development mode - watching for changes."
        );
        expect(mockLogger.log).toHaveBeenCalledTimes(3);
    });

    it("writes log statements to file", () => {

        const logLines = [
            "Watch configuration for service \"overseas-application\"",
            "- Action rebuild for path \"/do\"",
            "another log entry"
        ];
        const logMessage = logLines.join("\n");

        dockerComposeWatchLogHandler.handle(logMessage);

        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

        const call = mockWriteFileSync.mock.calls[0];

        expect(call[0]).toBe(logFile);
        expect(call[2]).toEqual({
            flag: "a"
        });

        const contentsWrittenToFile = call[1];

        for (const expectedLine of logLines) {
            // eslint-disable-next-line no-useless-escape
            const pattern = new RegExp(`\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\.\\d{3}Z\\s-\\s${expectedLine}`, "g");

            expect(pattern.test(contentsWrittenToFile)).toBe(true);
        }
    });

    it("writes cruft to file but not to console", () => {
        const logLines = [
            "A log line that was not expected",
            "Another log line that was not expected"
        ];
        const logMessage = logLines.join("\n");

        dockerComposeWatchLogHandler.handle(logMessage);

        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

        const call = mockWriteFileSync.mock.calls[0];

        const contentsWrittenToFile = call[1];

        for (const expectedLine of logLines) {
            // eslint-disable-next-line no-useless-escape
            const pattern = new RegExp(`\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\.\\d{3}Z\\s-\\s${expectedLine}`, "g");

            expect(pattern.test(contentsWrittenToFile)).toBe(true);
        }

        expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it("notifies console when service is being reloaded", () => {

        const logLines = [
            "Rebuilding service \"my-awesome-service\""
        ];
        const logMessage = logLines.join("\n");

        dockerComposeWatchLogHandler.handle(logMessage);

        expect(mockLogger.log).toHaveBeenCalledWith("Reloading service: my-awesome-service");
    });

    it("notifies console when service has been reloaded (previous docker compose version)", () => {
        const logLines = [
            "Rebuilding service \"my-awesome-service\"",
            "Another inconsequential log entry",
            "Container my-awesome-service Started"
        ];
        const logMessage = logLines.join("\n");

        dockerComposeWatchLogHandler.handle(logMessage);

        expect(mockLogger.log).toHaveBeenCalledWith(
            greenBright("Service: my-awesome-service reloaded")
        );
    });

    it("notifies console when service has been reloaded", () => {
        const logLines = [
            "Rebuilding service \"my-awesome-service\"",
            "Another inconsequential log entry",
            "service \"my-awesome-service\" successfully built"
        ];
        const logMessage = logLines.join("\n");

        dockerComposeWatchLogHandler.handle(logMessage);

        expect(mockLogger.log).toHaveBeenCalledWith(
            greenBright("Service: my-awesome-service reloaded")
        );
    });
});
