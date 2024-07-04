import { expect, jest } from "@jest/globals";
import { modules, services } from "../../utils/data";
import Disable from "../../../src/commands/development/disable";
import { Config } from "@oclif/core";

const excludeServiceFromLiveUpdateMock = jest.fn();
let snapshot;

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services,
                modules
            };
        }
    };
});

jest.mock("../../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot,
                excludeServiceFromLiveUpdate: excludeServiceFromLiveUpdateMock
            };
        }
    };
});

describe("development disable", () => {
    const cwdSpy = jest.spyOn(process, "cwd");
    const errorMock = jest.fn();
    const runHookMock = jest.fn();
    const parseMock = jest.fn();

    let developmentDisable: Disable;

    beforeEach(() => {
        jest.resetAllMocks();

        cwdSpy.mockReturnValue("./project");

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
            argv: ["service-two"]
        });

        await expect(developmentDisable.run()).resolves.toBeUndefined();

        expect(errorMock).not.toHaveBeenCalled();
        expect(runHookMock).toHaveBeenCalledTimes(1);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});

        expect(excludeServiceFromLiveUpdateMock).toHaveBeenCalledWith("service-two");

    });
});
