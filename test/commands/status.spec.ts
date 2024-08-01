import { jest, expect } from "@jest/globals";
import Status from "../../src/commands/status";
import { Config } from "@oclif/core";
import { State } from "../../src/model/State";
import { services, modules } from "../utils/data";

const snapshot: State = {
    modules: [
        "module-one"
    ],
    services: [
        "service-one",
        "service-two",
        "service-five",
        "service-six",
        "service-seven",
        "service-eight",
        "service-three"
    ],
    servicesWithLiveUpdate: [
        "service-two"
    ],
    excludedServices: [
        "service-three"
    ]
};

const getServiceStatusesMock = jest.fn();

jest.mock("../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services,
                modules
            };
        }
    };
});

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return { snapshot };
        }
    };
});

jest.mock("../../src/run/docker-compose", () => {
    return {
        DockerCompose: function () {
            return {
                getServiceStatuses: getServiceStatusesMock
            };
        }
    };
});

describe("Status command", () => {
    let status: Status;
    let testConfig: Config;
    let logMock;
    let logJsonMock;
    let runHookMock;
    let parseMock;

    beforeEach(() => {
        jest.resetAllMocks();

        const cwdSpy = jest.spyOn(process, "cwd");
        cwdSpy.mockReturnValue("/users/user/docker-chs/");

        runHookMock = jest.fn();

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", runHook: runHookMock };

        status = new Status([], testConfig);
        logMock = jest.spyOn(status, "log");
        // @ts-expect-error
        logJsonMock = jest.spyOn(status, "logJson");

        // @ts-expect-error
        parseMock = jest.spyOn(status, "parse");

        parseMock.mockResolvedValue({
            flags: {
                json: false
            }
        });
    });

    it("should log without docker compose statuses", async () => {
        await status.run();

        expect(logMock.mock.calls).toMatchSnapshot();
        expect(logJsonMock).not.toHaveBeenCalled();
    });

    it("should log with their docker compose statuses correctly", async () => {
        getServiceStatusesMock.mockReturnValue({
            "service-one": "Up 3 seconds (unhealthy)",
            "service-two": "Up 2 minutes (healthy)",
            "service-four": "Up 1 minute (health: starting)",
            "service-five": "Exited (0)",
            "service-six": "Exited (137)",
            "service-seven": "Up 33 minutes",
            "service-three": "Up About an hour (healthy)",
            "service-eight": "Up About an hour"
        });

        await status.run();

        expect(logMock.mock.calls).toMatchSnapshot();
    });

    it("should log json correctly", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: true
            }
        });
        getServiceStatusesMock.mockReturnValue({
            "service-one": "running",
            "service-two": "running",
            "service-five": "stopped",
            "service-four": "stopped"
        });

        await status.run();

        expect(logJsonMock).toHaveBeenCalledTimes(1);
        expect(logJsonMock.mock.calls[0]).toMatchSnapshot();

        expect(logMock).not.toHaveBeenCalled();
    });
});
