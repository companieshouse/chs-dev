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
            return { excludeService: disableServiceMock };
        }
    };
});

describe("services disable", () => {
    let parseMock;
    let logMock;

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
    });

    it("should disable a valid module", async () => {
        const serviceName = "service-one";

        parseMock.mockResolvedValue({
            args: {
                command: "disable",
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

});
