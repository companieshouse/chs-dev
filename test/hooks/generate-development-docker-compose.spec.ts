import { expect, jest } from "@jest/globals";
import { Inventory } from "../../src/state/inventory";
import { StateManager } from "../../src/state/state-manager";
import { DockerComposeFileGenerator } from "./../../src/generator/docker-compose-file-generator";
import loadConfig from "./../../src/helpers/config-loader.js";
import { hook as generateDevelopmentDockerComposeHook } from "./../../src/hooks/generate-development-docker-compose";

jest.mock("../../src/state/state-manager");
jest.mock("../../src/state/inventory");
jest.mock("./../../src/generator/docker-compose-file-generator");
jest.mock("./../../src/run/service-loader");
jest.mock("./../../src/helpers/config-loader");

describe("generate-development-docker-compose hook", () => {
    const mockConfig = {
        root: "./",
        configDir: "/users/user/.config/chs-dev/",
        cacheDir: "/mock/cache/dir"
    };
    const mockProjectPath = "/mock/project/path";
    const mockServiceName = "mock-service";
    const mockBuilderVersion = "v1.0.0";
    const mockExcludedServices = ["excluded-service"];
    const mockService = {
        name: mockServiceName,
        source: "/mock/source/path",
        builder: "node"
    };

    let generateDevelopmentServiceDockerComposeFileMock: jest.Mock;

    beforeEach(() => {
        jest.resetAllMocks();

        // Mock loadConfig
        (loadConfig as jest.Mock).mockReturnValue({
            projectPath: mockProjectPath
        });

        // Mock Inventory
        (Inventory as jest.Mock).mockImplementation(() => ({
            services: [mockService]
        }));

        // Mock DockerComposeFileGenerator
        generateDevelopmentServiceDockerComposeFileMock = jest.fn();
        (DockerComposeFileGenerator as jest.Mock).mockImplementation(() => ({
            generateDevelopmentServiceDockerComposeFile: generateDevelopmentServiceDockerComposeFileMock
        }));

        // Mock StateManager
        (StateManager as jest.Mock).mockImplementation(() => ({
            snapshot: {
                excludedServices: mockExcludedServices
            }
        }));
    });

    it("should generate a development docker-compose file for the specified service", async () => {
        // @ts-expect-error
        await generateDevelopmentDockerComposeHook({
            serviceName: mockServiceName,
            builderVersion: mockBuilderVersion,
            config: mockConfig,
            context: jest.fn()
        });

        expect(generateDevelopmentServiceDockerComposeFileMock).toHaveBeenCalledWith(
            mockService,
            mockBuilderVersion,
            mockExcludedServices
        );
    });

    it("should throw an error if the service does not exist", async () => {
        (Inventory as jest.Mock).mockImplementation(() => ({
            services: []
        }));

        const mockConfig2 = {
            root: "/mock/root",
            configDir: "/mock/config/dir",
            cacheDir: "/mock/cache/dir"
        } as any;

        const errorMock = jest.fn();
        const testContext = {
            error: errorMock,
            config: mockConfig2,
            debug: jest.fn(),
            exit: jest.fn(),
            log: jest.fn(),
            warn: jest.fn()
        };

        await generateDevelopmentDockerComposeHook.call(testContext, {
            serviceName: "non-existent-service",
            builderVersion: mockBuilderVersion,
            config: mockConfig2,
            context: testContext
        });

        expect(generateDevelopmentServiceDockerComposeFileMock).not.toHaveBeenCalled();
        expect(testContext.error).toHaveBeenCalledTimes(1);
        expect(errorMock).toHaveBeenCalledWith(
            "Cannot create development compose file for the service: non-existent-service since it does not exist."
        );
    });

    it("should throw a warning if the service does not have a builder", async () => {
        const mockServiceWithoutBuilder = {
            name: mockServiceName,
            source: "/mock/source/path"
        };

        (Inventory as jest.Mock).mockImplementation(() => ({
            services: [mockServiceWithoutBuilder]
        }));

        const warnMock = jest.fn();
        const testContext = {
            warn: warnMock
        };

        // @ts-expect-error
        await generateDevelopmentDockerComposeHook({
            serviceName: mockServiceName,
            builderVersion: mockBuilderVersion,
            config: mockConfig,
            context: testContext
        });

        expect(testContext.warn).toHaveBeenCalledTimes(3);
        expect(warnMock).toHaveBeenCalledWith("Ignore this message if this service is not a Node or Java service.");
        expect(warnMock).toHaveBeenCalledWith(`${mockServiceName}: Builder not found.`);
        expect(warnMock).toHaveBeenCalledWith(`Run: 'bin/migration/set_builder_label ${mockServiceName}' in the root directory`);
    });
});
