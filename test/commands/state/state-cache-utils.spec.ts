import * as stateCacheUtils from "../../../src/commands/state/state-cache-utils";
import { readFileContent, writeContentToFile } from "../../../src/helpers/file-utils";
import * as hashHelpers from "../../../src/helpers/index";
import yaml from "yaml";
import { existsSync } from "fs";
import { expect, jest } from "@jest/globals";
import Config from "../../../src/model/Config";

jest.mock("fs");
jest.mock("../../../src/helpers/file-utils");

describe("state-cache-utils", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("handlePrompt", () => {
        it("should call confirm with correct message for add", async () => {
            const confirmMock = jest.spyOn(require("../../../src/helpers/user-input"), "confirm").mockResolvedValue(true);
            await stateCacheUtils.handlePrompt("add", "myCache");
            expect(confirmMock).toHaveBeenCalledWith("This will save the cache as 'myCache' or overwrite if name already exists. Proceed?");
        });
        it("should call confirm with correct message for remove", async () => {
            const confirmMock = jest.spyOn(require("../../../src/helpers/user-input"), "confirm").mockResolvedValue(true);
            await stateCacheUtils.handlePrompt("remove", "myCache");
            expect(confirmMock).toHaveBeenCalledWith("Do you want to delete the cache 'myCache'?");
        });
    });

    describe("validateNameFormat", () => {
        it("should not throw if name format is valid", () => {
            expect(() => stateCacheUtils.validateNameFormat("test_one_1")).not.toThrow();
        });
        it("should throw iif name format is invalid", () => {
            const name = "temp/filename";
            expect(() => stateCacheUtils.validateNameFormat(name)).toThrow(`Invalid cache name format: '${name}'. Only alphanumeric characters with underscores or hypens are allowed.`);
        });
    });

    describe("validateCacheNameExists", () => {
        it("should not throw if cache exists", () => {
            expect(() => stateCacheUtils.validateCacheNameExists({ foo: {} }, "foo")).not.toThrow();
        });
        it("should throw if cache does not exist", () => {
            expect(() => stateCacheUtils.validateCacheNameExists({}, "bar")).toThrow("Cache named bar does not exist.");
        });
    });

    describe("verifyCacheAuthenticity", () => {
        it("should return cacheData if hashes match", () => {
            jest.spyOn(hashHelpers, "hashAlgorithm").mockReturnValue("hash");
            jest.spyOn(yaml, "stringify").mockReturnValue("yaml");
            const cacheData = {
                state: { snapshot: {}, hash: "hash" },
                dockerCompose: { snapshot: {}, hash: "hash" }
            };
            expect(stateCacheUtils.verifyCacheAuthenticity(cacheData)).toBe(cacheData);
        });
        it("should throw if hashes do not match", () => {
            jest.spyOn(hashHelpers, "hashAlgorithm").mockReturnValue("bad");
            jest.spyOn(yaml, "stringify").mockReturnValue("yaml");
            const cacheData = {
                state: { snapshot: {}, hash: "hash" },
                dockerCompose: { snapshot: {}, hash: "hash" }
            };
            expect(() => stateCacheUtils.verifyCacheAuthenticity(cacheData)).toThrow("Cache data has been corrupted or touched.");
        });
    });

    describe("validateCacheIncludePath", () => {
        const baseStateCache = {
            state: { snapshot: {}, hash: "" },
            dockerCompose: { snapshot: {}, hash: "" }
        };
        const baseConfig = {
            projectName: "myproject",
            projectPath: "/Users/test/myproject",
            env: {}
        };

        it("should return data unchanged if include is empty", () => {
            const data = JSON.parse(JSON.stringify(baseStateCache));
            data.dockerCompose.snapshot.include = [];
            expect(stateCacheUtils.validateCacheIncludePath(data, baseConfig)).toBe(data);
        });

        it("should throw if projectName is not found in imported path", () => {
            const data = JSON.parse(JSON.stringify(baseStateCache));
            data.dockerCompose.snapshot.include = ["/some/other/path/notfound/compose.yaml"];
            expect(() => stateCacheUtils.validateCacheIncludePath(data, baseConfig)).toThrow("myproject not found in cache include paths.");
        });

        it("should return data unchanged if imported path matches host project path", () => {
            const data = JSON.parse(JSON.stringify(baseStateCache));
            data.dockerCompose.snapshot.include = ["/Users/test/myproject/compose.yaml"];
            expect(stateCacheUtils.validateCacheIncludePath(data, baseConfig)).toBe(data);
        });

        it("should remap imported path to host project path if they differ", () => {
            const data = JSON.parse(JSON.stringify(baseStateCache));
            // Simulate imported cache from a different user
            data.dockerCompose.snapshot.include = ["/Users/otheruser/myproject/compose.yaml"];
            const result = stateCacheUtils.validateCacheIncludePath(data, baseConfig);
            expect(result.dockerCompose.snapshot.include[0]).toBe("/Users/test/myproject/compose.yaml");
        });
    });

    describe("loadImportCache", () => {
        it("should throw if file does not exist", () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            expect(() => stateCacheUtils.loadImportCache("/bad/path")).toThrow("Import cache file does not exist in location: /bad/path");
        });
        it("should throw if cache data is invalid", () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            (readFileContent as jest.Mock).mockReturnValue(undefined);
            expect(() => stateCacheUtils.loadImportCache("/bad/path")).toThrow("Invalid cache data in imported file: /bad/path");
        });
        it("should return cache data if valid", () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            const cacheData = { state: {}, dockerCompose: {} };
            (readFileContent as jest.Mock).mockReturnValue(cacheData);
            expect(stateCacheUtils.loadImportCache("/good/path")).toBe(cacheData);
        });
    });

    describe("restoreStateFiles", () => {
        it("should write state and dockerCompose snapshots to correct files", () => {
            const config = { projectPath: "/proj" } as Config;
            const state = { snapshot: { foo: "bar" } } as any;
            const dockerCompose = { snapshot: { baz: "qux" } } as any;
            const writeSpy = (writeContentToFile as jest.Mock).mockImplementation(() => {});
            stateCacheUtils.restoreStateFiles(config, state, dockerCompose);
            expect(writeSpy).toHaveBeenCalledWith(state.snapshot, "/proj/.chs-dev.yaml");
            expect(writeSpy).toHaveBeenCalledWith(dockerCompose.snapshot, "/proj/docker-compose.yaml");
        });
    });
});
