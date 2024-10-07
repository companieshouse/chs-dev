import { jest, expect } from "@jest/globals";
import Status from "../../src/commands/status";
import { Config } from "@oclif/core";
import { State } from "../../src/model/State";
import { services, modules } from "../utils/data";
import { Inventory } from "../../src/state/inventory";
import { StateManager } from "../../src/state/state-manager";
import { DockerCompose } from "../../src/run/docker-compose";
import loadConfigMock from "../../src/helpers/config-loader.js";

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

jest.mock("../../src/state/inventory");

jest.mock("../../src/state/state-manager");

jest.mock("../../src/run/docker-compose");

jest.mock("../../src/helpers/config-loader");

describe("Status command", () => {
    let status: Status;
    let testConfig: Config;
    let logMock;
    let logJsonMock;
    let runHookMock;
    let parseMock;

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        loadConfigMock.mockReturnValue({
            projectPath: "/users/user/docker-chs/"
        });

        runHookMock = jest.fn();

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", runHook: runHookMock };

        // @ts-expect-error
        Inventory.mockReturnValue({
            services,
            modules
        });

        // @ts-expect-error
        StateManager.mockReturnValue({
            snapshot
        });

        // @ts-expect-error
        DockerCompose.mockReturnValue({
            getServiceStatuses: getServiceStatusesMock
        });

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

    describe("transient services in development mode", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            // @ts-expect-error
            loadConfigMock.mockReturnValue({
                projectPath: "/users/user/docker-chs/"
            });

            // @ts-expect-error
            StateManager.mockReturnValue({
                snapshot: {
                    services: [
                        "service-one",
                        "service-seven"
                    ],
                    modules: ["module-three"],
                    servicesWithLiveUpdate: [
                        "service-six"
                    ],
                    excludedServices: [
                        "service-three"
                    ]
                }
            });

            // @ts-expect-error
            Inventory.mockReturnValue({
                services,
                modules
            });

            getServiceStatusesMock.mockReturnValue({
                "service-one": "running",
                "service-two": "running",
                "service-five": "stopped",
                "service-four": "stopped"
            });

            status = new Status([], testConfig);

            logMock = jest.spyOn(status, "log");

            // @ts-expect-error
            logJsonMock = jest.spyOn(status, "logJson");

            // @ts-expect-error
            parseMock = jest.spyOn(status, "parse");
        });

        it("should return correct log without six in development mode", async () => {
            parseMock.mockResolvedValue({
                flags: {
                    json: false
                }
            });
            await status.run();

            expect(logMock.mock.calls).toMatchSnapshot();
        });

        it("should show not show a service in live update if is not enabled", async () => {

            parseMock.mockResolvedValue({
                flags: {
                    json: true
                }
            });
            await status.run();

            expect(logJsonMock).toHaveBeenCalledTimes(1);
            expect(logJsonMock.mock.calls[0]).toMatchSnapshot();
        });
    });
});
