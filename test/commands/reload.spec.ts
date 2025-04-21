/* eslint-disable dot-notation */
import { beforeAll, expect, jest } from "@jest/globals";
import { Service } from "../../src/model/Service";
import { join } from "path";
import { Config } from "@oclif/core";
import Reload from "../../src/commands/reload";
import { DockerCompose } from "../../src/run/docker-compose";

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

jest.mock("../../src/run/docker-compose");

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

const dockerComposeMock = {
    up: jest.fn()
};

describe("reload spec", () => {
    let testConfig: Config;
    let reload: Reload;

    const projectDir = "./project";
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();

    beforeAll(() => {
        jest.resetAllMocks();
        // @ts-expect-error
        testConfig = { root: projectDir, configDir: join(projectDir, "config"), cacheDir: join(projectDir, "cache"), runHook: runHookMock };
    });

    beforeEach(() => {
        jest.resetAllMocks();

        loadConfigMock.mockReturnValue({
            projectPath: projectDir
        });

        reload = new Reload([], testConfig);
        // @ts-expect-error
        reload.parse = parseMock;
        reload.log = logMock;
        // @ts-expect-error
        reload.error = errorMock;

        // @ts-expect-error
        DockerCompose.mockReturnValue(dockerComposeMock);
    });

    it("should not reload an invalid service", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "not-found"
            },
            flags: {
                force: false
            }
        });
        jest.spyOn(reload as any, "checkServicesBuilder").mockReturnValue("node");
        await reload.run();

        expect(errorMock).toHaveBeenCalledWith("Service not-found is not found in inventory");
    });

    it("should reload a valid node service", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            flags: {
                force: false
            }
        });

        jest.spyOn(reload as any, "checkServicesBuilder").mockReturnValue("node");
        const restartMock = jest.spyOn(reload["dockerCompose"], "restart");

        await reload.run();

        expect(logMock).toHaveBeenCalledWith("Reloading Node Service: service-one");
        expect(restartMock).toHaveBeenCalledWith("service-one");
    });

    it("should reload a valid non-node service", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "service-two"
            },
            flags: {
                force: false
            }
        });

        jest.spyOn(reload as any, "checkServicesBuilder").mockReturnValue("non-node");
        const updateMock = jest.spyOn(reload["dependencyCache"], "update");
        const buildMock = jest.spyOn(reload["dockerCompose"], "build");
        const restartMock = jest.spyOn(reload["dockerCompose"], "restart");

        await reload.run();

        expect(updateMock).toHaveBeenCalled();
        expect(logMock).toHaveBeenCalledWith("Service: service-two building...");
        expect(buildMock).toHaveBeenCalledWith("service-two-builder");
        expect(logMock).toHaveBeenCalledWith("Service: service-two restarting...");
        expect(restartMock).toHaveBeenCalledWith("service-two");
    });

    it("should handle missing builder property in docker-compose", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            flags: {
                force: false
            }
        });

        jest.spyOn(reload as any, "checkServicesBuilder").mockReturnValue(undefined);

        await reload.run();

        expect(errorMock).toHaveBeenCalledWith("Service 'service-one' builder property missing in docker-compose");
    });

    it("should handle errors during reload", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            flags: {
                force: false
            }
        });

        jest.spyOn(reload as any, "checkServicesBuilder").mockReturnValue("node");
        jest.spyOn(reload["dockerCompose"], "restart").mockRejectedValue(new Error("Docker error"));
        const viewMock = jest.spyOn(reload["composeLogViewer"], "view").mockResolvedValue(undefined);

        await reload.run();

        expect(logMock).toHaveBeenCalledWith("\n" + "-".repeat(80));
        expect(logMock).toHaveBeenCalledWith("Recent Docker Compose Logs:");
        expect(viewMock).toHaveBeenCalledWith({ tail: "5", follow: false });
        expect(errorMock).toHaveBeenCalledWith(new Error("Docker error"));
    });

});
