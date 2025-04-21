import { expect, jest } from "@jest/globals";
import { existsSync, readFileSync } from "fs";
import { hook as checkDevelopmentServiceConfigHook } from "../../src/hooks/check-development-service-config";
import loadConfig from "./../../src/helpers/config-loader.js";
// import { join } from "path";
import path from "path";
import * as yaml from "yaml";

jest.mock("fs");
jest.mock("yaml");
jest.mock("./../../src/helpers/config-loader");

describe("check-development-service-config hook", () => {
    const mockContext = {
        warn: jest.fn(),
        error: jest.fn()
    };

    const mockProjectPath = "/mock/project/path";
    const mockService = {
        name: "mock-service",
        source: "/mock/source/path",
        builder: "node"
    };

    const mockServicesByBuilder = {
        node: [mockService]
    };
    const servicePath = path.join(mockProjectPath, "repositories", mockService.name);

    beforeEach(() => {
        jest.resetAllMocks();

        // Mock loadConfig
        (loadConfig as jest.Mock).mockReturnValue({
            projectPath: mockProjectPath
        });
    });

    it("should warn if service directory is missing", async () => {
        (existsSync as jest.Mock).mockImplementation((p) => false);

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ servicesByBuilder: { node: [mockService] }, context: mockContext });

        expect(mockContext.error).toHaveBeenCalledWith(
            expect.stringContaining("missing directory")
        );
    });

    it("should validate submodule integration and warn if label is missing", async () => {
        (existsSync as jest.Mock).mockImplementationOnce(() => true);
        (existsSync as jest.Mock).mockImplementationOnce((path: any) => {
            if (path.includes(".gitmodules")) {
                return true;
            }
        });
        const mockYaml = { services: { "service-one": { label: [] } } };
        (yaml.parse as jest.Mock).mockReturnValue(
            mockYaml
        );

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({
            servicesByBuilder: mockServicesByBuilder,
            context: mockContext
        });

        expect(mockContext.warn).toHaveBeenCalledWith(
            expect.stringContaining("Service mock-service is missing the label \"chs.local.builder.requiresSecrets=true\" in its docker-compose configuration as it depends on a submodule."));

    });

    it("should warn if package.json is missing", async () => {
        (existsSync as jest.Mock).mockImplementation((p) =>
            p === servicePath
        );

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ servicesByBuilder: { node: [mockService] }, context: mockContext });

        expect(mockContext.error).toHaveBeenCalledWith(
            expect.stringContaining("missing package.json")
        );
    });

    it("should warn if chs-dev script or nodemon devDependency is missing", async () => {
        (existsSync as jest.Mock).mockImplementationOnce(() => true);
        (existsSync as jest.Mock).mockImplementationOnce((p:any) => {
            if (p.includes(".gitmodules")) {
                return false;
            }
        });
        (existsSync as jest.Mock).mockImplementationOnce(() => true);

        (readFileSync as jest.Mock).mockImplementationOnce((p:any) => {
            if (p.includes("package.json")) {
                return JSON.stringify({ scripts: {}, devDependencies: {} });
            }
            return "";
        });

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ servicesByBuilder: { node: [mockService] }, context: mockContext });

        expect(mockContext.warn).toHaveBeenCalledWith(
            expect.stringContaining("chs-dev")
        );
        expect(mockContext.warn).toHaveBeenCalledWith(
            expect.stringContaining("nodemon package")
        );
    });

});
