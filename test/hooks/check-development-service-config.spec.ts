import { expect, jest } from "@jest/globals";
import { existsSync } from "fs";
import * as validators from "../../src/helpers/development-mode-validators.js";
import { hook as checkDevelopmentServiceConfigHook } from "../../src/hooks/check-development-service-config";
import loadConfig from "./../../src/helpers/config-loader.js";
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

    beforeEach(() => {
        jest.resetAllMocks();

        // Mock loadConfig
        (loadConfig as jest.Mock).mockReturnValue({
            projectPath: mockProjectPath
        });
    });

    it("should warn if service directory is missing", async () => {
        (existsSync as jest.Mock).mockImplementation((p) => false);
        jest.spyOn(validators, "isTypescriptProject").mockReturnValue(true);

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ services: [mockService], context: mockContext });

        expect(mockContext.error).toHaveBeenCalledWith(
            expect.stringContaining("missing directory")
        );
    });

    it("should warn if package.json is missing", async () => {
        (existsSync as jest.Mock).mockImplementationOnce((p) => true);
        jest.spyOn(validators, "isTypescriptProject").mockReturnValue(true);
        jest.spyOn(validators, "validateLabelForSubmodulesIntegration").mockReturnThis();

        (existsSync as jest.Mock).mockImplementationOnce((p) => false);

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ services: [mockService], context: mockContext });

        expect(mockContext.error).toHaveBeenCalledWith(
            expect.stringContaining("missing package.json")
        );
    });

    it("should warn if nodemon-entry.ts is missing", async () => {
        (existsSync as jest.Mock).mockImplementationOnce((p) => true);
        jest.spyOn(validators, "isTypescriptProject").mockReturnValue(true);
        jest.spyOn(validators, "validateLabelForSubmodulesIntegration").mockReturnThis();

        (existsSync as jest.Mock).mockImplementationOnce((p) => true);
        jest.spyOn(validators, "validateNodePackageJson").mockReturnThis();

        (existsSync as jest.Mock).mockImplementation((p) => false);

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ services: [mockService], context: mockContext });

        expect(mockContext.error).toHaveBeenCalledWith(
            expect.stringContaining("nodemon entry file in location: ./src/bin/nodemon-entry.ts or ./server/bin/nodemon-entry.ts")
        );
    });

    it("should warn if nodemon.json.ts is missing", async () => {
        (existsSync as jest.Mock).mockImplementationOnce((p) => true);
        jest.spyOn(validators, "isTypescriptProject").mockReturnValue(true);
        jest.spyOn(validators, "validateLabelForSubmodulesIntegration").mockReturnThis();

        (existsSync as jest.Mock).mockImplementationOnce((p) => true);
        jest.spyOn(validators, "validateNodePackageJson").mockReturnThis();

        (existsSync as jest.Mock).mockImplementationOnce((p) => true);
        jest.spyOn(validators, "validateNodemonJsonContent").mockReturnThis();

        (existsSync as jest.Mock).mockImplementation((p) => false);

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ services: [mockService], context: mockContext });

        expect(mockContext.error).toHaveBeenCalledWith(
            expect.stringContaining("nodemon.json")
        );
    });

    it("should warn if health check config is missing for java services", async () => {
        const mockService = {
            name: "mock-service",
            source: "/mock/source/path",
            builder: "java"
        };

        const mockYaml = { services: { "mock-service": { label: [] } } };
        (yaml.parse as jest.Mock).mockReturnValue(
            mockYaml
        );

        // @ts-expect-error
        await checkDevelopmentServiceConfigHook({ services: [mockService], context: mockContext });

        expect(mockContext.warn).toHaveBeenCalledWith(
            expect.stringContaining(
                "Service mock-service is missing the healthcheck property in its docker-compose.yaml file."
            )
        );
    });

});
