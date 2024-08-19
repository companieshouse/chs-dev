import { beforeAll, expect, jest } from "@jest/globals";
import loadConfigMock from "../../src/helpers/config-loader";
import fs from "fs";
import { join } from "path";
import { Hook, Config } from "@oclif/core";

jest.mock("../../src/helpers/config-loader");

describe("validate-project-state", () => {
    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    let testConfig: Config;
    let hook;

    beforeAll(async () => {
        ({ hook } = await import("../../src/hooks/validate-project-state"));
    });

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        loadConfigMock.mockReturnValue({
            projectPath: "/home/project"
        });

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", dataDir: "./data" };
    });

    it("checks resolves and does nothing if requiredFiles not supplied", async () => {
        const context = {
            warn: jest.fn(),
            error: jest.fn()
        };

        existsSyncSpy.mockReturnValue(true);

        await hook.bind(context as unknown as Hook.Context)({
            argv: [],
            config: testConfig,
            id: "status"
        });

        expect(existsSyncSpy).not.toHaveBeenCalled();
    });

    it("checks for each of the supplied files when supplied", async () => {
        const context = {
            warn: jest.fn(),
            error: jest.fn()
        };

        existsSyncSpy.mockReturnValue(true);

        await expect(hook.bind(context as unknown as Hook.Context)({
            argv: [],
            config: testConfig,
            id: "status",
            requiredFiles: [
                "services2",
                "docker-compose.yaml"
            ]
        })).resolves.toBe(undefined);

        expect(existsSyncSpy).toHaveBeenCalledWith(
            join("/home/project", "services2")
        );

        expect(existsSyncSpy).toHaveBeenCalledWith(
            join("/home/project", "docker-compose.yaml")
        );
    });

    it("calls error when some are missing", async () => {
        const context = {
            error: jest.fn()
        };

        existsSyncSpy.mockReturnValueOnce(true).mockReturnValue(false);

        await expect(hook({
            argv: [],
            config: testConfig,
            id: "status",
            requiredFiles: [
                "services2",
                "docker-compose.yaml",
                "file2.txt"
            ],
            context
        })).rejects.toEqual(new Error("Not valid project"));

        expect(context.error).toHaveBeenCalledWith(
            "Not being run in a valid project: cannot find docker-compose.yaml, file2.txt in project directory", {
                exit: 1,
                code: "1",
                suggestions: [
                    "Try again from a valid chs-dev project"
                ]
            }
        );
    });

    it("calls error with provided suggestions when some are missing", async () => {
        const context = {
            error: jest.fn()
        };

        existsSyncSpy.mockReturnValueOnce(true).mockReturnValue(false);

        await expect(hook({
            argv: [],
            config: testConfig,
            id: "status",
            requiredFiles: [
                "services2",
                "docker-compose.yaml",
                "file2.txt"
            ],
            suggestionsOnFailure: [
                "suggestionOne"
            ],
            context
        })).rejects.toEqual(new Error("Not valid project"));

        expect(context.error).toHaveBeenCalledWith(
            "Not being run in a valid project: cannot find docker-compose.yaml, file2.txt in project directory", {
                exit: 1,
                code: "1",
                suggestions: [
                    "suggestionOne"
                ]
            }
        );
    });

    const okToCallFromNonProject = [
        ["status", ["--help"]],
        ["--version", []],
        ["help", ["status"]],
        ["--help", []]
    ];

    for (const testCase of okToCallFromNonProject) {
        it("does nothing if call is either help or version", async () => {
            existsSyncSpy.mockReturnValue(false);

            const context = {
                warn: jest.fn(),
                error: jest.fn()
            };
            const options = {
                config: testConfig,
                id: testCase[0] as string,
                argv: testCase[1] as string[],
                context,
                requiredFiles: [
                    "services"
                ]
            };

            await hook(options);

            expect(context.error).not.toHaveBeenCalled();
        });
    }

});
