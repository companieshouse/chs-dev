import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Service } from "../../src/state/inventory";
// @ts-expect-error it does exist
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { Config } from "@oclif/core";
import Reload from "../../src/commands/reload";

const ensureFileMock = jest.fn();
const utimesMock = jest.fn();

const updateDependencyCacheMock = jest.fn();

const services: Service[] = [{
    name: "service-one",
    module: "module-one",
    source: "",
    dependsOn: [],
    builder: "",
    metadata: {}
}, {
    name: "service-two",
    module: "module-two",
    source: "",
    dependsOn: [],
    builder: "",
    metadata: {}
}];

jest.mock("../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services
            };
        }
    };
});

jest.mock("../../src/run/dependency-cache", () => {
    return {
        DependencyCache: function () {
            return { update: updateDependencyCacheMock };
        }
    };
});

jest.mock("fs-extra", () => {
    return {
        ensureFile: (file) => ensureFileMock(file),
        utimes: (file, timeOne, timeTwo) => utimesMock(file, timeOne, timeTwo)
    };
});

describe("reload spec", () => {
    let tempDir;
    let testConfig: Config;
    let reload: Reload;
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();
    const cwdSpy = jest.spyOn(process, "cwd");

    const testDateTime = new Date(2023, 1, 1, 0, 0, 0);

    beforeAll(() => {
        jest.resetAllMocks();
        tempDir = mkdtempSync("reload-command");
        // @ts-expect-error
        testConfig = { root: tempDir, configDir: join(tempDir, "config"), runHook: runHookMock };

        reload = new Reload([], testConfig);

        // @ts-expect-error
        reload.parse = parseMock;
        reload.log = logMock;
        // @ts-expect-error
        reload.error = errorMock;
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        jest.resetAllMocks();
        // @ts-expect-error
        Date.now = () => testDateTime;
        cwdSpy.mockReturnValue(tempDir);
    });

    it("should not reload an invalid service", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "not-found"
            }
        });

        await reload.run();

        expect(ensureFileMock).not.toHaveBeenCalled();
        expect(utimesMock).not.toHaveBeenCalled();
        expect(errorMock).toHaveBeenCalledWith("Service not-found is not found in inventory");
    });

    it("updates dependency cache when service is valid", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            }
        });

        await reload.run();

        expect(updateDependencyCacheMock).toHaveBeenCalledTimes(1);
    });

    it("touches touch file when service is valid", async () => {
        // @ts-expect-error
        ensureFileMock.mockResolvedValue(undefined);

        // @ts-expect-error
        utimesMock.mockResolvedValue(undefined);

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            }
        });

        await reload.run();

        expect(ensureFileMock).toHaveBeenCalledWith(join(tempDir, "local/service-one/.touch"));
        expect(utimesMock).toHaveBeenCalledWith(join(tempDir, "local/service-one/.touch"), testDateTime, testDateTime);
    });

});
