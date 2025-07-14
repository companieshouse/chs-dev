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
