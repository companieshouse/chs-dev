import PatternMatchingConsoleLogHandler from "../../../src/run/logs/PatternMatchingConsoleLogHandler";
import { expect, jest } from "@jest/globals";
import fs from "fs";

describe("PatternMatchingConsoleLogHandler", () => {
    const writeFileSpy = jest.spyOn(fs, "writeFileSync");

    const mockLogger = {
        log: jest.fn()
    };

    const pattern = /Container\s([\dA-Za-z-]*)\s*(Started|Healthy|Stopped)/;
    let patternMatchingConsoleLogHandler;

    beforeEach(() => {
        patternMatchingConsoleLogHandler = new PatternMatchingConsoleLogHandler(
            pattern, "/tmp/log.txt", mockLogger
        );
    });

    it("only logs events matching pattern", () => {
        const logLines = [
            "Container service-one Started",
            "Container service-one Healthy",
            "Container service-one Removing",
            "Container service-one Stopping",
            "Container service-one Stopped",
            "Container service-one Removed"
        ];

        patternMatchingConsoleLogHandler.handle(
            logLines.join("\n")
        );

        const linesWrittenToFile = writeFileSpy.mock.calls[0][1].split("\n");

        // Trailing new line at end of file will increase length by 1
        expect(linesWrittenToFile).toHaveLength(logLines.length + 1);

        expect(mockLogger.log.mock.calls).toEqual(
            [["Service service-one Started"],
                ["Service service-one Healthy"],
                ["Service service-one Stopped"]]
        );
    });

    it("colourises logs", () => {
        const colouriseMock = jest.fn();

        patternMatchingConsoleLogHandler = new PatternMatchingConsoleLogHandler(
            // @ts-expect-error
            pattern, "/tmp/log.txt", mockLogger, colouriseMock
        );

        const logLines = [
            "Container service-one Started",
            "Container service-one Healthy",
            "Container service-one Removing",
            "Container service-one Stopping",
            "Container service-one Stopped",
            "Container service-one Removed"
        ];

        patternMatchingConsoleLogHandler.handle(
            logLines.join("\n")
        );

        expect(colouriseMock.mock.calls).toEqual([
            ["Started"],
            ["Healthy"],
            ["Stopped"]
        ]);

    });
});
