import { beforeAll, expect, jest } from "@jest/globals";
import { Service } from "../../src/model/Service";
import { join } from "path";
import { Config } from "@oclif/core";
import Reload from "../../src/commands/reload";

const ensureFileMock = jest.fn();
const utimesMock = jest.fn();

const updateDependencyCacheMock = jest.fn();

const loadConfigMock = jest.fn();

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
    module: "module-two",
    source: "",
    dependsOn: [],
    builder: "",
    metadata: {},
    repository: null
}];

jest.mock("../../src/helpers/config-loader", () => {
    return function () {
        return loadConfigMock();
    };
});

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
    let testConfig: Config;
    let reload: Reload;

    const projectDir = "./project";
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();

    const testDateTime = new Date(2023, 1, 1, 0, 0, 0);

    beforeAll(() => {
        jest.resetAllMocks();
        // @ts-expect-error
        testConfig = { root: projectDir, configDir: join(projectDir, "config"), cacheDir: join(projectDir, "cache"), runHook: runHookMock };
    });

    beforeEach(() => {
        jest.resetAllMocks();
        // @ts-expect-error
        Date.now = () => testDateTime;

        loadConfigMock.mockReturnValue({
            projectPath: projectDir
        });

        reload = new Reload([], testConfig);
        // @ts-expect-error
        reload.parse = parseMock;
        reload.log = logMock;
        // @ts-expect-error
        reload.error = errorMock;
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

        expect(ensureFileMock).toHaveBeenCalledWith(join(projectDir, "local/service-one/.touch"));
        expect(utimesMock).toHaveBeenCalledWith(join(projectDir, "local/service-one/.touch"), testDateTime, testDateTime);
    });

});
