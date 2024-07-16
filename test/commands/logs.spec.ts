import { beforeAll, expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";
import Logs from "../../src/commands/logs";
import { join } from "path";

const dockerComposeLogsMock = jest.fn();
const composeLogViewerViewMock = jest.fn();

jest.mock("../../src/run/docker-compose", () => {
    return {
        DockerCompose: function () {
            return { logs: dockerComposeLogsMock };
        }
    };
});

jest.mock("../../src/helpers/config-loader", function () {
    return jest.fn().mockImplementation(() => ({
        env: {},
        projectPath: "."
    }));
});

jest.mock("../../src/run/compose-log-viewer", function () {
    return {
        ComposeLogViewer: function () {
            return {
                view: composeLogViewerViewMock
            };
        }
    };
});

describe("Logs command", () => {
    let testConfig: Config;
    let logsCommand: Logs;
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();
    const cwdSpy = jest.spyOn(process, "cwd");

    beforeAll(() => {
        jest.resetAllMocks();
        // @ts-expect-error
        testConfig = { root: "./", configDir: join("./", "config"), cacheDir: join("./", "cache") };

        logsCommand = new Logs([], testConfig);

        // @ts-expect-error
        logsCommand.parse = parseMock;
        logsCommand.log = logMock;
        // @ts-expect-error
        logsCommand.error = errorMock;
    });

    it("follows all logs when no service provided", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                serviceName: undefined
            },
            flags: {
                compose: false,
                follow: false,
                tail: "all"
            }
        });

        await logsCommand.run();

        expect(dockerComposeLogsMock).toHaveBeenCalledWith({ serviceName: undefined, tail: "all", follow: false });
    });

    it("follows service logs when service provided", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                serviceName: "service-one"
            },
            flags: {
                compose: false,
                follow: true,
                tail: "2"
            },
            argv: [
                "service-one"
            ]
        });

        await logsCommand.run();

        expect(dockerComposeLogsMock).toHaveBeenCalledWith({
            serviceNames: ["service-one"],
            tail: "2",
            follow: true
        });
    });

    it("follows service logs for multiple services when service names provided", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                serviceName: "service-one"
            },
            flags: {
                compose: false,
                follow: true,
                tail: "2"
            },
            argv: [
                "service-one",
                "service-two"
            ]
        });

        await logsCommand.run();

        expect(dockerComposeLogsMock).toHaveBeenCalledWith({
            serviceNames: ["service-one", "service-two"],
            tail: "2",
            follow: true,
            signal: undefined
        });
    });

    it("views compose logs when compose flag is specified", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                serviceName: undefined
            },
            flags: {
                compose: true,
                follow: false,
                tail: "all"
            }
        });

        await logsCommand.run();

        expect(composeLogViewerViewMock).toHaveBeenCalledWith({
            tail: "all",
            follow: false
        });
    });

    it("shows tail compose logs when compose flag is specified", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                serviceName: undefined
            },
            flags: {
                compose: true,
                follow: false,
                tail: "1"
            }
        });

        await logsCommand.run();

        expect(composeLogViewerViewMock).toHaveBeenCalledWith({
            tail: "1",
            follow: false
        });
    });

    it("follows compose logs when compose flag is specified", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                serviceName: undefined
            },
            flags: {
                compose: true,
                follow: true,
                tail: "all"
            }
        });

        await logsCommand.run();

        expect(composeLogViewerViewMock).toHaveBeenCalledWith({
            tail: "all",
            follow: true
        });
    });
});
