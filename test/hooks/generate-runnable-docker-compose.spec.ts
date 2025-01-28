import { expect, jest } from "@jest/globals";
import { hook as generateRunnableDockerCompose } from "./../../src/hooks/generate-runnable-docker-compose";
import { Inventory } from "../../src/state/inventory";
import { StateManager } from "../../src/state/state-manager";
import { DockerComposeFileGenerator } from "./../../src/generator/docker-compose-file-generator";
import loadConfig from "./../../src/helpers/config-loader.js";
import { ServiceLoader } from "./../../src/run/service-loader";
import { modules } from "../utils/data";

jest.mock("../../src/state/state-manager");
jest.mock("../../src/state/inventory");
jest.mock("./../../src/generator/docker-compose-file-generator");
jest.mock("./../../src/run/service-loader");
jest.mock("./../../src/helpers/config-loader");

describe("generate-runnable-docker-compose hook", () => {
    const mockPath = "/mock/path";
    const mockCacheDir = "/mock/cache/dir";
    const mockConfig = { projectPath: mockPath };

    beforeEach(() => {
        jest.clearAllMocks();
        (loadConfig as jest.Mock).mockReturnValue(mockConfig);
    });

    it("should generate a runnable Docker Compose file", async () => {
        // Mocking state
        const mockSnapshot = { excludedServices: ["serviceA", "serviceB"] };
        const mockStateManager = {
            snapshot: mockSnapshot
        };

        // Mocking inventory
        const mockInventory = { modules };
        (Inventory as jest.Mock).mockImplementation(() => mockInventory);

        // Mocking state manager
        (StateManager as jest.Mock).mockImplementation(() => mockStateManager);

        // Mocking enabled services
        const mockEnabledServices = [
            { name: "service1" },
            { name: "service2" }
        ];

        const mockServiceLoader = {
            loadServices: jest.fn().mockReturnValue(mockEnabledServices)
        };
        (ServiceLoader as jest.Mock).mockImplementation(() => mockServiceLoader);

        // Mocking DockerComposeFileGenerator
        const mockDockerComposeFileGenerator = {
            generateDockerComposeFile: jest.fn()
        };
        (DockerComposeFileGenerator as jest.Mock).mockImplementation(
            () => mockDockerComposeFileGenerator
        );
        const testContext = jest.fn();
        // Run the hook

        // @ts-expect-error
        await generateRunnableDockerCompose({
            config: { cacheDir: mockCacheDir },
            context: testContext
        });

        // Assertions
        expect(loadConfig).toHaveBeenCalled();
        expect(Inventory).toHaveBeenCalledWith(mockPath, mockCacheDir);
        expect(StateManager).toHaveBeenCalledWith(mockPath);
        expect(ServiceLoader).toHaveBeenCalledWith(mockInventory);
        expect(mockServiceLoader.loadServices).toHaveBeenCalledWith(mockSnapshot);
        expect(mockDockerComposeFileGenerator.generateDockerComposeFile).toHaveBeenCalledWith(
            mockEnabledServices
        );
    });

    it("should generate a exclusion Docker Compose file", async () => {
        // Mocking state
        const mockSnapshot = { excludedServices: ["serviceA", "serviceB"] };
        const mockStateManager = {
            snapshot: mockSnapshot
        };

        // Mocking inventory
        const mockInventory = { modules };
        (Inventory as jest.Mock).mockImplementation(() => mockInventory);

        // Mocking state manager
        (StateManager as jest.Mock).mockImplementation(() => mockStateManager);

        // Mocking enabled services
        const mockEnabledServices = [
            { name: "service1" },
            { name: "service2" }
        ];

        const mockServiceLoader = {
            loadServices: jest.fn().mockReturnValue(mockEnabledServices)
        };
        (ServiceLoader as jest.Mock).mockImplementation(() => mockServiceLoader);

        // Mocking DockerComposeFileGenerator
        const mockDockerComposeFileGenerator = {
            generateExclusionDockerComposeFiles: jest.fn()
        };
        (DockerComposeFileGenerator as jest.Mock).mockImplementation(
            () => mockDockerComposeFileGenerator
        );
        const testContext = jest.fn();
        // Run the hook

        // @ts-expect-error
        await generateRunnableDockerCompose({
            config: { cacheDir: mockCacheDir },
            generateExclusionSpec: true,
            context: testContext
        });

        // Assertions
        expect(loadConfig).toHaveBeenCalled();
        expect(Inventory).toHaveBeenCalledWith(mockPath, mockCacheDir);
        expect(StateManager).toHaveBeenCalledWith(mockPath);
        expect(ServiceLoader).toHaveBeenCalledWith(mockInventory);
        expect(mockServiceLoader.loadServices).toHaveBeenCalledWith(mockSnapshot);
        expect(mockDockerComposeFileGenerator.generateExclusionDockerComposeFiles).toHaveBeenCalledWith(
            mockEnabledServices,
            ["serviceA", "serviceB"]
        );
    });
});
