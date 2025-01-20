import { expect, jest } from "@jest/globals";
import { services } from "../../utils/data";
import { Config } from "@oclif/core";
import Enable from "../../../src/commands/services/enable";

const enableServiceMock = jest.fn();

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
                includeService: enableServiceMock,
                snapshot: {
                    excludedServices: ["serviceA", "serviceB"]
                }
            };
        }
    };
});

describe("services enable", () => {
    let parseMock;
    let logMock;

    const runHookMock = jest.fn();

    let servicesEnable: Enable;

    beforeEach(() => {
        jest.resetAllMocks();

        servicesEnable = new Enable(
            // @ts-expect-error
            [], {
                cacheDir: "./caches",
                runHook: runHookMock
            } as Config
        );

        logMock = jest.spyOn(servicesEnable, "log");
        // @ts-expect-error
        parseMock = jest.spyOn(servicesEnable, "parse");
    });

    it("should enable a valid module", async () => {
        const serviceName = "service-one";

        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                services: serviceName
            },
            argv: [
                serviceName
            ]
        });

        await servicesEnable.run();

        expect(enableServiceMock).toHaveBeenCalledWith(serviceName);
        expect(logMock).toHaveBeenCalledWith(`Service "${serviceName}" is enabled`);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when enabling an invalid module", async () => {
        const serviceName = "invalidService";

        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                services: serviceName
            },
            argv: [
                serviceName
            ]
        });

        await expect(servicesEnable.run()).rejects.toEqual(new Error(
            `Service "${serviceName}" is not defined in inventory`
        ));

        expect(runHookMock).not.toHaveBeenCalled();
    });

});
