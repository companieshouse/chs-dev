import {
    AddCacheStrategy,
    AvailableCacheStrategy,
    ExportCacheStrategy,
    RemoveCacheStrategy,
    WipeCacheStrategy
} from "../../../src/commands/state/CacheActionStrategy";
import { writeContentToFile } from "../../../src/helpers/file-utils";
import { getGeneratedDockerComposeFile } from "../../../src/helpers/docker-compose-file";
import { hashAlgorithm } from "../../../src/helpers/index";
import { confirm as confirmMock } from "../../../src/helpers/user-input";
import yaml from "yaml";
import { expect, jest } from "@jest/globals";
import { existsSync } from "fs";

jest.mock("fs");
jest.mock("yaml");
jest.mock("../../../src/helpers/file-utils");
jest.mock("../../../src/helpers/docker-compose-file");
jest.mock("../../../src/helpers/index");
jest.mock("../../../src/helpers/user-input");

describe("CacheActionStrategy", () => {
    let mockCache: any;
    let stateCache: any;
    let cacheData: any;

    beforeEach(() => {
        mockCache = {
            log: jest.fn(),
            error: jest.fn(),
            chsDevConfig: { projectPath: "/proj" },
            stateCacheFile: "/proj/cache.yaml",
            stateManager: { snapshot: { foo: "bar" } }
        };
        stateCache = {
            state: {
                snapshot: { foo: "bar" },
                hash: (hashAlgorithm as jest.Mock).mockReturnValue(yaml.stringify({ foo: "bar" }))
            },
            dockerCompose: {
                snapshot: { baz: "qux" },
                hash: (hashAlgorithm as jest.Mock).mockReturnValue(yaml.stringify({ baz: "qux" }))
            }
        };
        cacheData = { testCacheName: stateCache };
        (confirmMock as jest.Mock).mockReturnValue(true);
        (getGeneratedDockerComposeFile as jest.Mock).mockReturnValue({ dc: "data" });
        mockCache.error.mockImplementation((msg: string) => { throw new Error(msg); });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("AvailableCacheStrategy", () => {
        it("logs available caches", () => {
            new AvailableCacheStrategy().execute(mockCache, cacheData);
            expect(mockCache.log).toHaveBeenCalledWith("Available caches:");
            expect(mockCache.log).toHaveBeenCalledWith("- testCacheName");
        });
        it("logs when no caches are available", () => {
            new AvailableCacheStrategy().execute(mockCache, {});
            expect(mockCache.log).toHaveBeenCalledWith("No cache available.");
        });
    });

    describe("WipeCacheStrategy", () => {
        it("wipes all caches if confirmed", async () => {
            await new WipeCacheStrategy().execute(mockCache, cacheData);
            expect(writeContentToFile).toHaveBeenCalledWith({}, mockCache.stateCacheFile);
            expect(mockCache.log).toHaveBeenCalledWith("Wiped all caches");
        });
        it("does not wipe if not confirmed", async () => {
            (confirmMock as jest.Mock).mockReturnValue(false);
            await new WipeCacheStrategy().execute(mockCache, cacheData);
            expect(writeContentToFile as jest.Mock).not.toHaveBeenCalled();
        });
    });

    describe("RemoveCacheStrategy", () => {
        it("removes a cache if confirmed", async () => {
            await new RemoveCacheStrategy().execute(mockCache, cacheData, "testCacheName");
            expect(writeContentToFile).toHaveBeenCalledWith(cacheData, mockCache.stateCacheFile);
            expect(mockCache.log).toHaveBeenCalledWith("Removed cache 'testCacheName'");
            expect(cacheData.testCacheName).toBeUndefined();
        });
        it("throws if cache does not exist", async () => {
            await expect(new RemoveCacheStrategy().execute(mockCache, cacheData, "baz")).rejects.toThrow("Cache named baz does not exist.");
        });
        it("does not remove if not confirmed", async () => {
            (confirmMock as jest.Mock).mockReturnValue(false);
            await new RemoveCacheStrategy().execute(mockCache, cacheData, "testCacheName");
            expect(writeContentToFile).not.toHaveBeenCalled();
        });
    });

    describe("ExportCacheStrategy", () => {
        beforeEach(() => {
            (existsSync as jest.Mock).mockReturnValue(false);
        });

        it("exports a cache if it exists", async () => {
            await new ExportCacheStrategy().execute(mockCache, cacheData, "testCacheName");
            expect(writeContentToFile).toHaveBeenCalled();
            expect(mockCache.log).toHaveBeenCalledWith(expect.stringContaining("Exported cache testCacheName destination"));
        });
        it("throws if cache does not exist", async () => {
            await expect(new ExportCacheStrategy().execute(mockCache, cacheData, "foo")).rejects.toThrow("Cache named foo does not exist.");
        });
    });

    describe("AddCacheStrategy", () => {
        it("adds a cache if confirmed", async () => {
            await new AddCacheStrategy().execute(mockCache, cacheData, "newcache");
            expect(writeContentToFile).toHaveBeenCalledWith(cacheData, mockCache.stateCacheFile);
            expect(mockCache.log).toHaveBeenCalledWith("Saved cache as 'newcache'");
            expect(cacheData.newcache).toBeDefined();
        });
        it("does not add if not confirmed", async () => {
            (confirmMock as jest.Mock).mockReturnValue(false);
            await new AddCacheStrategy().execute(mockCache, cacheData, "newcache");
            expect(writeContentToFile).not.toHaveBeenCalled();
            expect(cacheData.newcache).toBeUndefined();
        });
    });
});
