import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Module, Service } from "../../src/state/inventory";
// @ts-expect-error it does exist
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { Config } from "@oclif/core";
import Services from "../../src/commands/services";

let snapshot;

const services: Service[] = [{
    name: "service-one",
    module: "module-one",
    source: "",
    dependsOn: [],
    builder: "",
    metadata: {},
    repository: null
}, {
    name: "service-two",
    module: "module-one",
    source: "",
    dependsOn: [],
    builder: "",
    metadata: {},
    repository: null
}];

const modules: Module[] = [{
    name: "module-one"
}, {
    name: "module-two"
}];

const enableServiceMock = jest.fn();
const disableServiceMock = jest.fn();

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot,
                includeService: enableServiceMock,
                excludeService: disableServiceMock
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

describe("services command", () => {
    let tempDir;
    let testConfig: Config;
    let services: Services;
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();
    const cwdSpy = jest.spyOn(process, "cwd");

    beforeAll(() => {
        jest.resetAllMocks();
        tempDir = mkdtempSync("services-command");
        // @ts-expect-error
        testConfig = { root: tempDir, configDir: join(tempDir, "config"), runHook: runHookMock };

        services = new Services([], testConfig);

        // @ts-expect-error
        services.parse = parseMock;
        services.log = logMock;
        // @ts-expect-error
        services.error = errorMock;
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        cwdSpy.mockReturnValue(tempDir);
        jest.resetAllMocks();
    });

    it("prints out available services", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "available"
            }
        });

        await services.run();

        expect(logMock).toHaveBeenCalledTimes(3);
        expect(logMock).toHaveBeenCalledWith("Available services:");
        expect(logMock).toHaveBeenCalledWith(" - service-one");
        expect(logMock).toHaveBeenCalledWith(" - service-two");
    });

    it("should enable a valid module", async () => {
        const serviceName = "service-one";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                services: serviceName
            }
        });

        await services.run();

        expect(enableServiceMock).toHaveBeenCalledWith(serviceName);
        expect(logMock).toHaveBeenCalledWith(`Service "${serviceName}" is enabled`);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when enabling an invalid module", async () => {
        const serviceName = "invalidService";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                services: serviceName
            }
        });

        await services.run();

        expect(errorMock).toHaveBeenCalledWith(`Service "${serviceName}" is not defined in inventory`);
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("should disable a valid module", async () => {
        const serviceName = "service-one";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                services: serviceName
            }
        });

        await services.run();

        expect(disableServiceMock).toHaveBeenCalledWith(serviceName);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

    it("should log an error when disabling an invalid module", async () => {
        const serviceName = "invalid-module";

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable",
                services: serviceName
            }
        });

        await services.run();

        expect(errorMock).toHaveBeenCalledWith(`Service "${serviceName}" is not defined in inventory`);
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("should log an error when disabling without module argument", async () => {
    // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "disable"
            }
        });

        await services.run();

        expect(errorMock).toHaveBeenCalledWith("Service must be provided");
    });

    it("should log an error when enabling without module argument", async () => {
    // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable"
            }
        });

        await services.run();

        expect(errorMock).toHaveBeenCalledWith("Service must be provided");
    });
});
