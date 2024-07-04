import { expect, jest } from "@jest/globals";
import Enable from "../../../src/commands/modules/enable";
import { modules } from "../../utils/data";
import { Config } from "@oclif/core";

const includeModuleMock = jest.fn();

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
                includeModule: includeModuleMock
            };
        }
    };
});

describe("modules enable", () => {
    const runHookMock = jest.fn();

    let logMock;
    let parseMock;

    let enableModules;

    beforeEach(() => {
        jest.resetAllMocks();

        enableModules = new Enable(
            // @ts-expect-error
            [], {
                cacheDir: "./caches",
                runHook: runHookMock
            } as Config
        );

        logMock = jest.spyOn(enableModules, "log");
        parseMock = jest.spyOn(enableModules, "parse");

    });

    it("should enable a valid module", async () => {
        const moduleName = "module-one";

        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                module: moduleName
            },
            argv: [
                moduleName
            ]
        });

        await enableModules.run();

        expect(includeModuleMock).toHaveBeenCalledWith(moduleName);
        expect(logMock).toHaveBeenCalledWith(`Module "${moduleName}" is enabled`);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when enabling an invalid module", async () => {
        const moduleName = "invalidModule";

        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                module: moduleName
            },
            argv: [
                moduleName
            ]
        });

        await expect(enableModules.run()).rejects.toEqual(new Error(
            `Module "${moduleName}" is not defined in inventory`
        ));

        expect(runHookMock).not.toHaveBeenCalled();
    });
});
