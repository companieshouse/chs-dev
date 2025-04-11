import { expect, jest } from "@jest/globals";
import { gray, greenBright, redBright, yellowBright } from "ansis";
import DockerComposeWatchLogHandler from "../../../src/run/logs/DockerComposeWatchLogHandler";

describe("DockerComposeWatchLogHandler", () => {
    const mockLogger = {
        log: jest.fn()
    };

    let dockerComposeWatchLogHandler;

    beforeEach(() => {
        jest.resetAllMocks();
        dockerComposeWatchLogHandler = new DockerComposeWatchLogHandler(mockLogger);
    });

    const applicationLogTestCases = [
        {
            description: "logs npm install commencing events",
            logMessage: `"my-service" | npm install commencing.`,
            expectedLog: gray("Nodemon: my-service installing dependencies!")
        },
        {
            description: "logs application ready events",
            logMessage: `"my-service" | Application Ready.`,
            expectedLog: greenBright("Nodemon: my-service ready!")
        },
        {
            description: "logs application restarting events",
            logMessage: `"my-service" | Application Restarting...`,
            expectedLog: yellowBright("Nodemon: my-service restarting...")
        },
        {
            description: "logs application crashed events",
            logMessage: `"my-service" | Application Crashed!`,
            expectedLog: redBright("Nodemon: my-service crashed!")
        },
        {
            description: "logs service reload events",
            logMessage: `"my-service" exited with code 0`,
            expectedLog: greenBright("Service: my-service reloaded!")
        }
    ];

    test.each(applicationLogTestCases)(
        "$description",
        ({ logMessage, expectedLog }) => {
            dockerComposeWatchLogHandler.handle(logMessage);
            expect(mockLogger.log).toHaveBeenCalledWith(expectedLog);
        }
    );

    it("handles multiple new log entries", () => {
        const logMessages = [
            `"service-one" | npm install commencing.`,
            `"service-two" | Application Ready.`,
            `"service-three" | Application Restarting...`,
            `"service-four" | Application Crashed!`,
            `"service-five" exited with code 0`
        ].join("\n");

        dockerComposeWatchLogHandler.handle(logMessages);

        expect(mockLogger.log).toHaveBeenCalledWith(
            gray("Nodemon: service-one installing dependencies!")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            greenBright("Nodemon: service-two ready!")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            yellowBright("Nodemon: service-three restarting...")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            redBright("Nodemon: service-four crashed!")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            greenBright("Service: service-five reloaded!")
        );
        expect(mockLogger.log).toHaveBeenCalledTimes(5);
    });
});
