import { expect, jest } from "@jest/globals";
import { services } from "../../utils/data";
import { Config } from "@oclif/core";
import Disable from "../../../src/commands/services/disable";

const disableServiceMock = jest.fn();

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services
            };
        }
    };
});

jest.mock("../../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                excludeService: disableServiceMock,
                snapshot: {
                    services: ["service-one"],
                    modules: [],
                    excludedServices: ["service-one", "service-two"]
                }
            };
        }
    };
});

describe("services disable", () => {
    const checkStateHookObjectMock = { topic: "services" };
    let parseMock;
    let logMock;
    let handlePostHookCallMock;
    let handleServiceModuleStateHookMock;

    const runHookMock = jest.fn();

    let servicesDisable: Disable;

    beforeEach(() => {
        jest.resetAllMocks();

        servicesDisable = new Disable(
            // @ts-expect-error
            [], {
                cacheDir: "./caches",
                runHook: runHookMock
            } as Config
        );

        logMock = jest.spyOn(servicesDisable, "log");
        // @ts-expect-error
        parseMock = jest.spyOn(servicesDisable, "parse");
        handleServiceModuleStateHookMock = jest.spyOn(servicesDisable as any, "handleServiceModuleStateHook").mockReturnValue([]);
        handlePostHookCallMock = jest.spyOn(servicesDisable as any, "handlePostHookCall").mockImplementation(() => {
            handleServiceModuleStateHookMock(checkStateHookObjectMock);
        });

    });

    it("should disable a valid module", async () => {
        const serviceName = "service-one";

        parseMock.mockResolvedValue({
            args: {
                command: `disable:${serviceName}`,
                services: serviceName
            },
            argv: [
                serviceName
            ]
        });

        await servicesDisable.run();

        expect(disableServiceMock).toHaveBeenCalledWith(serviceName);
        expect(logMock).toHaveBeenCalledWith(`Service "${serviceName}" is disabled`);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when enabling an invalid module", async () => {
        const serviceName = "invalidService";

        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                services: serviceName
            },
            argv: [
                serviceName
            ]
        });

        await expect(servicesDisable.run()).rejects.toEqual(new Error(
            `Service "${serviceName}" is not defined in inventory`
        ));

        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("should call the post hook check after command execution", async () => {
        const serviceName = "service-one";

        parseMock.mockResolvedValue({
            args: {
                command: `disable:${serviceName}`,
                services: serviceName
            },
            argv: [
                serviceName
            ]
        });

        await servicesDisable.run();

        expect(handlePostHookCallMock).toHaveBeenCalled();
        expect(handleServiceModuleStateHookMock).toHaveBeenCalledWith(checkStateHookObjectMock);

    });

});
