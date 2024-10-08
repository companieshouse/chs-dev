import { expect, jest } from "@jest/globals";
import fs from "fs";
import LogNothingLogHandler from "../../../src/run/logs/LogNothingLogHandler";

describe("LogNothingLogHandler", () => {

    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    const logFile = "/home/user/project/something.log";

    beforeEach(() => {
        jest.resetAllMocks();

        writeFileSyncSpy.mockImplementation((_, __) => {});
    });

    it("does not log any lines", () => {
        const loggerMock = {
            log: jest.fn()
        };

        const logNothingLogHandler = new LogNothingLogHandler(logFile, loggerMock);

        logNothingLogHandler.handle("one\ntwo\n\tthree\n");

        expect(loggerMock.log).not.toHaveBeenCalled();
    });

    it("does write log entries to file", () => {
        const logLines = [
            "Watch configuration for service \"overseas-application\"",
            "- Action rebuild for path \"/do\"",
            "another log entry"
        ];
        const logMessage = logLines.join("\n");
        const loggerMock = {
            log: jest.fn()
        };

        const logNothingLogHandler = new LogNothingLogHandler(logFile, loggerMock);

        logNothingLogHandler.handle(logMessage);

        expect(writeFileSyncSpy).toHaveBeenCalledTimes(1);

        const call = writeFileSyncSpy.mock.calls[0];

        expect(call[0]).toBe(logFile);
        expect(call[2]).toEqual({
            flag: "a"
        });

        const contentsWrittenToFile = call[1];

        for (const expectedLine of logLines) {
            // eslint-disable-next-line no-useless-escape
            const pattern = new RegExp(`\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\.\\d{3}Z\\s-\\s${expectedLine}`, "g");

            expect(pattern.test(contentsWrittenToFile.toString())).toBe(true);
        }
    });

});
