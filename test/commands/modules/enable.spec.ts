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
                includeModule: includeModuleMock,
                snapshot: {
                    services: ["service-one"],
                    modules: [],
                    excludedServices: ["service-one", "service-two"]
                }
            };
        }
    };
});

describe("modules enable", () => {
    const runHookMock = jest.fn();
    const checkStateHookObjectMock = { topic: "modules" };

    let logMock;
    let parseMock;
    let handlePostHookCallMock;
    let handleServiceModuleStateHookMock;

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
        handleServiceModuleStateHookMock = jest.spyOn(enableModules as any, "handleServiceModuleStateHook").mockReturnValue([]);
        handlePostHookCallMock = jest.spyOn(enableModules as any, "handlePostHookCall").mockImplementation(() => {
            handleServiceModuleStateHookMock(checkStateHookObjectMock);
        });

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

    it("should call the post hook check after command execution", async () => {
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

        expect(handlePostHookCallMock).toHaveBeenCalled();
        expect(handleServiceModuleStateHookMock).toHaveBeenCalledWith(checkStateHookObjectMock);
    });
});
