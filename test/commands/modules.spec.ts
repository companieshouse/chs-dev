import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Module, Service, Inventory } from "../../src/state/inventory";
import { StateManager } from "../../src/state/state-manager";
// @ts-expect-error it does exist
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { Config } from "@oclif/core";
import Modules from "../../src/commands/modules";

let snapshot;

const services: Service[] = [{
    name: "service-one",
    module: "module-one",
    source: "",
    dependsOn: [],
    builder: "",
    metadata: {}
}];

const modules: Module[] = [{
    name: "module-one"
}, {
    name: "module-two"
}];

const enableModuleMock = jest.fn();
const disableModuleMock = jest.fn();

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot,
                includeModule: enableModuleMock,
                excludeModule: disableModuleMock
            };
        }
    };
});

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

describe("modules command", () => {
    let tempDir;
    let testConfig: Config;
    let modules: Modules;
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();
    const cwdSpy = jest.spyOn(process, "cwd");

    beforeAll(() => {
        jest.resetAllMocks();
        tempDir = mkdtempSync("modules-command");
        // @ts-expect-error
        testConfig = { root: tempDir, configDir: join(tempDir, "config"), runHook: runHookMock };

        modules = new Modules([], testConfig);

        // @ts-expect-error
        modules.parse = parseMock;
        modules.log = logMock;
        // @ts-expect-error
        modules.error = errorMock;
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        cwdSpy.mockReturnValue(tempDir);
        jest.resetAllMocks();
    });

    it("prints out available modules", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "available"
            }
        });

        await modules.run();

        expect(logMock).toHaveBeenCalledTimes(3);
        expect(logMock).toHaveBeenCalledWith("Available modules:");
        expect(logMock).toHaveBeenCalledWith(" - module-one");
        expect(logMock).toHaveBeenCalledWith(" - module-two");
    });

    it("should enable a valid module", async () => {
        const moduleName = "module-one";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                module: moduleName
            }
        });

        await modules.run();

        expect(enableModuleMock).toHaveBeenCalledWith(moduleName);
        expect(logMock).toHaveBeenCalledWith(`Module "${moduleName}" is enabled`);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when enabling an invalid module", async () => {
        const moduleName = "invalidModule";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                module: moduleName
            }
        });

        await modules.run();

        expect(errorMock).toHaveBeenCalledWith(`Module "${moduleName}" is not defined in inventory`);
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("should disable a valid module", async () => {
        const moduleName = "module-one";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                module: moduleName
            }
        });

        await modules.run();

        expect(disableModuleMock).toHaveBeenCalledWith(moduleName);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when disabling an invalid module", async () => {
        const moduleName = "invalid-module";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                module: moduleName
            }
        });

        await modules.run();

        expect(errorMock).toHaveBeenCalledWith(`Module "${moduleName}" is not defined in inventory`);
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("should log an error when disabling without module argument", async () => {
    // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable"
            }
        });

        await modules.run();

        expect(errorMock).toHaveBeenCalledWith("Module must be provided");
    });

    it("should log an error when enabling without module argument", async () => {
    // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable"
            }
        });

        await modules.run();

        expect(errorMock).toHaveBeenCalledWith("Module must be provided");
    });
});
