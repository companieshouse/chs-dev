import { expect, jest } from "@jest/globals";
import { gray, greenBright, red, redBright, yellowBright } from "ansis";
import DockerComposeWatchLogHandler from "../../../src/run/logs/DockerComposeWatchLogHandler";

describe("DockerComposeWatchLogHandler", () => {
    const mockLogger = {
        log: jest.fn()
    };

    let dockerComposeWatchLogHandler;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2025-05-06T09:11:03.266Z"));
        jest.resetAllMocks();
        dockerComposeWatchLogHandler = new DockerComposeWatchLogHandler(mockLogger);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const applicationLogTestCases = [
        {
            description: "logs npm install commencing events",
            logMessage: `"my-service" | npm install commencing.`,
            expectedLog: gray(`2025-05-06T09:11:03.266Z - Service: my-service installing dependencies!`)
        },
        {
            description: "logs npm install failed events",
            logMessage: `"my-service" | npm install failed!.`,
            expectedLog: red(`2025-05-06T09:11:03.266Z - Service: my-service installing dependencies failed!`)
        },
        {
            description: "logs application ready events",
            logMessage: `"my-service" | Application Ready.`,
            expectedLog: greenBright(`2025-05-06T09:11:03.266Z - Service: my-service ready!`)
        },
        {
            description: "logs application restarting events",
            logMessage: `"my-service" | Nodemon Restarting...`,
            expectedLog: yellowBright(`2025-05-06T09:11:03.266Z - Nodemon: my-service restarting...`)
        },
        {
            description: "logs application crashed events",
            logMessage: `"my-service" | Nodemon Crashed!`,
            expectedLog: redBright(`2025-05-06T09:11:03.266Z - Nodemon: my-service crashed!`)
        },
        {
            description: "logs service healthy status events",
            logMessage: `Container my-service healthy`,
            expectedLog: greenBright(`2025-05-06T09:11:03.266Z - Service: my-service ready!`)
        },
        {
            description: "logs service unhealthy status events",
            logMessage: `Container my-service unhealthy`,
            expectedLog: redBright(`2025-05-06T09:11:03.266Z - Service: my-service crashed!`)
        }
    ];

    test.each(applicationLogTestCases)(
        "$description",
        ({ logMessage, expectedLog }) => {
            dockerComposeWatchLogHandler.handle(logMessage);
            expect(mockLogger.log).toHaveBeenCalledWith(expectedLog.toString());
        }
    );

    it("ignores empty log entries", () => {
        const logMessages = "\n\n";

        dockerComposeWatchLogHandler.handle(logMessages);

        expect(mockLogger.log).not.toHaveBeenCalled();
    });
});
