import { expect, jest } from "@jest/globals";
import Disable from "../../../src/commands/modules/disable";
import { modules } from "../../utils/data";
import { Config } from "@oclif/core";

const excludeModuleMock = jest.fn();

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                modules
            };
        }
    };
});

jest.mock("../../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                excludeModule: excludeModuleMock
            };
        }
    };
});

describe("modules disable", () => {
    const runHookMock = jest.fn();

    let logMock;
    let parseMock;

    let disableModules;

    beforeEach(() => {
        jest.resetAllMocks();

        disableModules = new Disable(
            // @ts-expect-error
            [], {
                cacheDir: "./caches",
                runHook: runHookMock
            } as Config
        );

        logMock = jest.spyOn(disableModules, "log");
        parseMock = jest.spyOn(disableModules, "parse");

    });

    it("should disable a valid module", async () => {
        const moduleName = "module-one";

        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                module: moduleName
            },
            argv: [
                moduleName
            ]
        });

        await disableModules.run();

        expect(excludeModuleMock).toHaveBeenCalledWith(moduleName);
        expect(logMock).toHaveBeenCalledWith(`Module "${moduleName}" is disabled`);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when enabling an invalid module", async () => {
        const moduleName = "invalidModule";

        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                module: moduleName
            },
            argv: [
                moduleName
            ]
        });

        await expect(disableModules.run()).rejects.toEqual(new Error(
            `Module "${moduleName}" is not defined in inventory`
        ));

        expect(runHookMock).not.toHaveBeenCalled();
    });
});
