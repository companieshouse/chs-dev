import { expect, jest } from "@jest/globals";
import { LogEverythingLogHandler } from "../../../src/run/logs/LogEverythingLogHandler";

describe("LogEverythingLogHandler", () => {

    it("logs each line", () => {
        const loggerMock = {
            log: jest.fn()
        };

        const logEverythingLogHandler = new LogEverythingLogHandler(loggerMock);

        logEverythingLogHandler.handle("one\ntwo\n\tthree\n");

        expect(loggerMock.log).toHaveBeenCalledTimes(3);
        expect(loggerMock.log).toHaveBeenCalledWith("one");
        expect(loggerMock.log).toHaveBeenCalledWith("two");
        expect(loggerMock.log).toHaveBeenCalledWith("\tthree");
    });

    it("logs each line with prefix", () => {

        const loggerMock = {
            log: jest.fn()
        };

        const logEverythingLogHandler = new LogEverythingLogHandler(loggerMock, "ERROR:\t");

        logEverythingLogHandler.handle("one\ntwo\n\tthree\n");

        expect(loggerMock.log).toHaveBeenCalledTimes(3);
        expect(loggerMock.log).toHaveBeenCalledWith("ERROR:\tone");
        expect(loggerMock.log).toHaveBeenCalledWith("ERROR:\ttwo");
        expect(loggerMock.log).toHaveBeenCalledWith("ERROR:\t\tthree");
    });
});
