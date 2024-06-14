import { expect, jest } from "@jest/globals";
import { Hook } from "@oclif/core";
import { Service } from "../../src/state/inventory";

describe("Hook: generate-development-docker-compose", () => {
    const generateDevelopmentServiceDockerComposeFileMock =
        jest.fn();

    const inventoryServicesFindMock = jest.fn();

    const testConfig = {
        root: "./",
        configDir: "/users/user/.config/chs-dev/"
    };

    jest.mock("../../src/generator/docker-compose-file-generator", () => {
        return {
            DockerComposeFileGenerator: function () {
                return {
                    generateDevelopmentServiceDockerComposeFile: generateDevelopmentServiceDockerComposeFileMock
                };
            }
        };
    });

    jest.mock("../../src/state/inventory", () => {
        return {
            Inventory: function () {
                return {
                    services: {
                        find: inventoryServicesFindMock
                    }
                };
            }
        };
    });

    let generateDevelopmentDockerComposeHook: Hook<"generate-development-docker-compose">;

    beforeEach(async () => {
        jest.resetAllMocks();

        generateDevelopmentDockerComposeHook = (await import("../../src/hooks/generate-development-docker-compose")).hook;
    });

    it("generates development docker compose file", async () => {
        const service: Service = {
            name: "service",
            module: "module",
            source: "./services/modules/module/service.docker-compose.yaml",
            repository: null,
            dependsOn: [],
            builder: "",
            metadata: {}
        };
        inventoryServicesFindMock.mockReturnValue(service);

        const testContext = jest.fn();

        // @ts-expect-error
        await generateDevelopmentDockerComposeHook({
            serviceName: "service",
            config: testConfig,
            context: testContext
        });

        expect(generateDevelopmentServiceDockerComposeFileMock).toHaveBeenCalledWith(service);
    });

    it("does not generate docker compose when service not found", async () => {

        inventoryServicesFindMock.mockReturnValue(undefined);

        const testContext = {
            error: jest.fn()
        };

        // @ts-expect-error
        await generateDevelopmentDockerComposeHook.apply(testContext, [{
            serviceName: "service",
            config: testConfig,
            context: testContext
        }]);

        expect(generateDevelopmentServiceDockerComposeFileMock).not.toHaveBeenCalled();
        expect(testContext.error).toHaveBeenCalledTimes(1);
    });

});
