import { expect, jest } from "@jest/globals";
import { modules, services } from "../../utils/data";
import Disable from "../../../src/commands/development/disable";
import { Inventory } from "../../../src/state/inventory";
import { StateManager } from "../../../src/state/state-manager";
import { Config } from "@oclif/core";
import Module from "../../../src/model/Module";
import { DockerCompose } from "../../../src/run/docker-compose";

const excludeServiceFromLiveUpdateMock = jest.fn();
let snapshot;

const inventoryMock = {
    services,
    modules: modules as Module[]
};

const stateManagerMock = {
    snapshot: {
        excludedServices: ["serviceA", "serviceB"]
    },
    excludeServiceFromLiveUpdate: excludeServiceFromLiveUpdateMock
};

const dockerComposeMock = {
    pull: jest.fn()
};

jest.mock("../../../src/state/inventory");

jest.mock("../../../src/state/state-manager");

jest.mock("../../../src/run/docker-compose");

describe("development disable", () => {
    const cwdSpy = jest.spyOn(process, "cwd");
    const errorMock = jest.fn();
    const runHookMock = jest.fn();
    const parseMock = jest.fn();

    let developmentDisable: Disable;

    beforeEach(() => {
        jest.resetAllMocks();

        cwdSpy.mockReturnValue("./project");

        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        // @ts-expect-error
        StateManager.mockReturnValue(stateManagerMock);

        // @ts-expect-error
        DockerCompose.mockReturnValue(dockerComposeMock);

        developmentDisable = new Disable(
            // @ts-expect-error
            [], { cacheDir: "./caches", runHook: runHookMock } as Config
        );

        // @ts-expect-error
        developmentDisable.error = errorMock;

        // @ts-expect-error
        developmentDisable.parse = parseMock;
    });

    it("errors when service name not supplied", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                services: ""
            },
            flags: {
                noPull: false
            },
            argv: []
        });

        await developmentDisable.run();

        expect(errorMock).toHaveBeenCalledWith("Service not supplied");
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("errors when there is a list of blank services", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                services: ""
            },
            flags: {
                noPull: false
            },
            argv: [
                "",
                "",
                ""
            ]
        });

        await expect(developmentDisable.run()).rejects.toEqual(expect.any(Error));

        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("errors when service does not exist", async () => {
        const serviceName = "not-found";
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                services: serviceName
            },
            flags: {
                noPull: false
            },
            argv: [
                serviceName
            ]
        });

        await expect(developmentDisable.run()).rejects.toEqual(new Error(
            `Service "${serviceName}" is not defined in inventory`
        ));
    });

    it("removes service from live update and regenerates docker compose file", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                services: "service-two"
            },
            flags: {
                noPull: false
            },
            argv: ["service-two"]
        });

        await expect(developmentDisable.run()).resolves.toBeUndefined();

        expect(errorMock).not.toHaveBeenCalled();
        expect(runHookMock).toHaveBeenCalledTimes(1);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});

        expect(excludeServiceFromLiveUpdateMock).toHaveBeenCalledWith("service-two");

    });

    it("runs docker compose pull", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                services: "service-two"
            },
            flags: {
                noPull: false
            },
            argv: ["service-two"]
        });

        await expect(developmentDisable.run()).resolves.toBeUndefined();

        expect(dockerComposeMock.pull).toHaveBeenCalledWith(
            "service-two"
        );
    });

    it("does not run docker compose pull when noPull true", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                services: "service-two"
            },
            flags: {
                noPull: true
            },
            argv: ["service-two"]
        });

        await expect(developmentDisable.run()).resolves.toBeUndefined();

        expect(dockerComposeMock.pull).not.toHaveBeenCalled();
    });
});
