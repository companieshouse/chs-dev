import { expect, jest } from "@jest/globals";
import { gray, greenBright, red, redBright, yellowBright } from "ansis";
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
            expectedLog: gray("Service: my-service installing dependencies!")
        },
        {
            description: "logs npm install failed events",
            logMessage: `"my-service" | npm install failed!.`,
            expectedLog: red("Service: my-service installing dependencies failed!")
        },
        {
            description: "logs application ready events",
            logMessage: `"my-service" | Application Ready.`,
            expectedLog: greenBright("Service: my-service ready!")
        },
        {
            description: "logs application restarting events",
            logMessage: `"my-service" | Nodemon Restarting...`,
            expectedLog: yellowBright("Nodemon: my-service restarting...")
        },
        {
            description: "logs application crashed events",
            logMessage: `"my-service" | Nodemon Crashed!`,
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

    it("handles multiple log entries", () => {
        const logMessages = [
            `"service-one" | npm install commencing.`,
            `"service-two" | npm install failed!.`,
            `"service-three" | Application Ready.`,
            `"service-four" | Nodemon Restarting...`,
            `"service-five" | Nodemon Crashed!`,
            `"service-six" exited with code 0`
        ].join("\n");

        dockerComposeWatchLogHandler.handle(logMessages);

        expect(mockLogger.log).toHaveBeenCalledWith(
            gray("Service: service-one installing dependencies!")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            red("Service: service-two installing dependencies failed!")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            greenBright("Service: service-three ready!")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            yellowBright("Nodemon: service-four restarting...")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            redBright("Nodemon: service-five crashed!")
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
            greenBright("Service: service-six reloaded!")
        );
        expect(mockLogger.log).toHaveBeenCalledTimes(6);
    });

    it("ignores empty log entries", () => {
        const logMessages = "\n\n";

        dockerComposeWatchLogHandler.handle(logMessages);

        expect(mockLogger.log).not.toHaveBeenCalled();
    });
});
