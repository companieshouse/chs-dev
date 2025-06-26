import { expect, jest } from "@jest/globals";
import { existsSync, readFileSync } from "fs";
import * as yaml from "yaml";
import {
    isTypescriptProject,
    validateLabelForSubmodulesIntegration,
    validateNodePackageJson,
    validateNodemonEntryContent,
    validateNodemonJsonContent
} from "../../src/helpers/development-mode-validators";
import Service from "../../src/model/Service";

jest.mock("fs");
jest.mock("yaml");

describe("development-mode-validators", () => {
    const mockContext = {
        warn: jest.fn(),
        error: jest.fn()
    };
    const ext = "ts";

    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe("validateLabelForSubmodulesIntegration", () => {
        it("should warn if required label is missing in docker-compose configuration", () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            const mockYaml = { services: { "mock-service": { label: [] } } };
            (yaml.parse as jest.Mock).mockReturnValue(
                mockYaml
            );

            validateLabelForSubmodulesIntegration(
                "/mock/service/path",
                {
                    name: "mock-service",
                    source: "/mock/source/path"
                } as Service,
                mockContext
            );

            expect(mockContext.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Service mock-service is missing the label \"chs.local.builder.requiresSecrets=true\""
                )
            );
        });

        it("should not warn if required label is present", () => {
            (existsSync as jest.Mock).mockReturnValue(true);

            const mockYaml = { services: { "mock-service": { labels: ["chs.local.builder.requiresSecrets=true"] } } };
            (yaml.parse as jest.Mock).mockReturnValue(
                mockYaml
            );

            validateLabelForSubmodulesIntegration(
                "/mock/service/path",
                {
                    name: "mock-service",
                    source: "/mock/source/path"
                } as Service,
                mockContext
            );

            expect(mockContext.warn).not.toHaveBeenCalled();
        });
    });

    describe("validateNodePackageJson", () => {
        it("should warn if chs-dev script or nodemon devDependency is missing", () => {
            (readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    scripts: {},
                    devDependencies: {}
                })
            );

            validateNodePackageJson("/mock/package.json", "mock-service", mockContext);

            expect(mockContext.warn).toHaveBeenCalledWith(
                expect.stringContaining("chs-dev")
            );
            expect(mockContext.warn).toHaveBeenCalledWith(
                expect.stringContaining("nodemon package")
            );
        });

        it("should not warn if chs-dev script and nodemon devDependency are present", () => {
            (readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    scripts: { "chs-dev": "nodemon --legacy-watch" },
                    devDependencies: { nodemon: "^2.0.0" }
                })
            );

            validateNodePackageJson("/mock/package.json", "mock-service", mockContext);

            expect(mockContext.warn).not.toHaveBeenCalled();
        });
    });

    describe("validateNodemonEntryContent", () => {
        it("should warn if nodemon entry file is missing required listen or log lines", () => {
            (readFileSync as jest.Mock).mockReturnValue("console.log('Missing listen');");

            validateNodemonEntryContent(
                "/mock/nodemon-entry.ts",
                "mock-service",
                mockContext
            );

            expect(mockContext.warn).toHaveBeenCalledWith(
                expect.stringContaining("missing the required listen event or log line")
            );
        });

        it("should not warn if nodemon entry file contains required listen and log lines", () => {
            (readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify(
                    // eslint-disable-next-line no-template-curly-in-string
                    ".listen(PORT, () => { console.log(`✅ Application Ready. Running on port ${PORT}`); });"
                )
            );

            validateNodemonEntryContent(
                "/mock/nodemon-entry.ts",
                "mock-service",
                mockContext
            );

            expect(mockContext.warn).not.toHaveBeenCalled();
        });
    });

    describe("validateNodemonJsonContent", () => {

        it("should warn if the expected nodemon.json file is missing", () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            const expectedConfigPath = "/mock/project/path/local/builders/node/v3/bin/config/nodemon.json";
            validateNodemonJsonContent(
                "/mock/project/path",
                "/mock/nodemon.json",
                "mock-service",
                ext,
                mockContext
            );

            expect(mockContext.warn).toHaveBeenCalledWith(
                expect.stringContaining(`Expected nodemon configuration file is missing at ${expectedConfigPath}.`)
            );
        });
        it("should warn if nodemon.json configuration is incorrect", () => {
            (existsSync as jest.Mock).mockReturnValue(true);

            (readFileSync as jest.Mock).mockReturnValueOnce(JSON.stringify({
                exec: "ts-node ./src/bin/nodemon-entry.ts",
                ext: "ts,html",
                watch: ["./src", "./views"],
                events: {
                    restart: "echo '🔄 '  Nodemon Restarting...",
                    crash: "echo '💥 '  Nodemon Crashed!"
                }
            }));
            (readFileSync as jest.Mock).mockReturnValueOnce(JSON.stringify({
                events: { restart: "echo 'restarting...'" },
                exec: "node index.js",
                watch: []
            }));

            validateNodemonJsonContent(
                "/mock/project/path",
                "/mock/nodemon.json",
                "mock-service",
                ext,
                mockContext
            );

            expect(mockContext.warn).toHaveBeenCalledWith(
                expect.stringContaining("incorrect nodemon.json configuration")
            );
        });

        it("should not warn if nodemon.json configuration is correct", () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    events: { restart: "echo 'restarting...'" },
                    exec: "ts-node /bin/nodemon-entry.ts",
                    watch: ["src"]
                })
            );

            validateNodemonJsonContent(
                "/mock/project/path",
                "/mock/nodemon.json",
                "mock-service",
                ext,
                mockContext
            );

            expect(mockContext.warn).not.toHaveBeenCalled();
        });
    });

    describe("isTypescriptProject", () => {

        it("should return true if the service is Typescript supported", () => {
            (readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    dependencies: {
                        "@types/node": "^14.0.0"
                    },
                    devDependencies: {
                        typescript: "^4.0.0"
                    }
                })
            );
            (existsSync as jest.Mock).mockReturnValue(true);

            const result = isTypescriptProject("/mock/service/path", "/mock/package.json");

            expect(result).toBe(true);

        });
        it("should return false if the service is not Typescript supported", () => {
            (readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify({
                    dependencies: {
                        "@types/node": "^14.0.0"
                    },
                    devDependencies: {}
                })
            );
            (existsSync as jest.Mock).mockReturnValue(false);

            const result = isTypescriptProject("/mock/service/path", "/mock/package.json");

            expect(result).toBe(false);

        });
    });
});
