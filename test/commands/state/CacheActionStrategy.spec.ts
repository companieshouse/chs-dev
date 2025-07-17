import { expect, jest } from "@jest/globals";
import {
    AddCacheStrategy,
    AvailableCacheStrategy,
    ExportCacheStrategy,
    RemoveCacheStrategy,
    WipeCacheStrategy
} from "../../../src/commands/state/CacheActionStrategy";
import * as stateCacheUtils from "../../../src/commands/state/state-cache-utils";
import * as dockerComposeFile from "../../../src/helpers/docker-compose-file";
import * as fileUtils from "../../../src/helpers/file-utils";
import * as hashHelpers from "../../../src/helpers/index";
import { DockerComposeSpec } from "../../../src/model/DockerComposeSpec";

describe("CacheActionStrategy", () => {
    let logger: jest.Mock;
    let stateManager: any;
    let cacheData: Record<string, any>;
    let stateCacheFile: string;
    let projectPath: string;

    beforeEach(() => {
        logger = jest.fn();
        stateManager = { snapshot: { foo: "bar" } };
        cacheData = { testCache: { state: { hash: "hash", snapshot: {} }, dockerCompose: { hash: "hash", snapshot: {} } } };
        stateCacheFile = "/tmp/cache.yaml";
        projectPath = "/tmp";
        jest.spyOn(stateCacheUtils, "handlePrompt").mockResolvedValue(true);
        jest.spyOn(stateCacheUtils, "validateCacheNameExists").mockImplementation((data, name) => {
            if (!data[name]) throw new Error(`Cache named ${name} does not exist.`);
        });
        jest.spyOn(stateCacheUtils, "restoreStateFiles").mockImplementation(() => {});
        jest.spyOn(fileUtils, "writeContentToFile").mockImplementation(() => {});
        jest.spyOn(dockerComposeFile, "getGeneratedDockerComposeFile").mockReturnValue({} as DockerComposeSpec);
        jest.spyOn(hashHelpers, "hashAlgorithm").mockReturnValue("hash");
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("AvailableCacheStrategy logs available caches", () => {
        new AvailableCacheStrategy().execute({ logger }, cacheData);
        expect(logger).toHaveBeenCalledWith("Available caches:");
        expect(logger).toHaveBeenCalledWith("- testCache");
    });

    it("AvailableCacheStrategy logs when no caches are available", () => {
        new AvailableCacheStrategy().execute({ logger }, {});
        expect(logger).toHaveBeenCalledWith("No cache available.");
    });

    it("WipeCacheStrategy wipes all caches if confirmed", async () => {
        await new WipeCacheStrategy().execute({ stateCacheFile, logger }, cacheData);
        expect(fileUtils.writeContentToFile).toHaveBeenCalledWith({}, stateCacheFile);
        expect(logger).toHaveBeenCalledWith("Wiped all caches");
    });

    it("RemoveCacheStrategy removes a cache if confirmed", async () => {
        await new RemoveCacheStrategy().execute({ stateCacheFile, logger }, { testCache: {} }, "testCache");
        expect(fileUtils.writeContentToFile).toHaveBeenCalledWith({}, stateCacheFile);
        expect(logger).toHaveBeenCalledWith("Removed cache 'testCache'");
    });

    it("RemoveCacheStrategy throws if cache does not exist", async () => {
        await expect(new RemoveCacheStrategy().execute({ stateCacheFile, logger }, {}, "missing")).rejects.toThrow("Cache named missing does not exist.");
    });

    it("ExportCacheStrategy exports a cache if it exists", async () => {
        await new ExportCacheStrategy().execute({ projectPath, logger }, cacheData, "testCache");
        expect(fileUtils.writeContentToFile).toHaveBeenCalled();
        expect(logger).toHaveBeenCalledWith(expect.stringContaining("Exported cache testCache destination"));
    });

    it("ExportCacheStrategy throws if cache does not exist", async () => {
        await expect(new ExportCacheStrategy().execute({ projectPath, logger }, {}, "missing")).rejects.toThrow("Cache named missing does not exist.");
    });

    it("AddCacheStrategy adds a cache if name format is valid and prompt confirmed", async () => {
        await new AddCacheStrategy().execute({ stateManager, stateCacheFile, projectPath, logger }, {}, "newCache");
        expect(fileUtils.writeContentToFile).toHaveBeenCalledWith(expect.any(Object), stateCacheFile);
        expect(logger).toHaveBeenCalledWith("Saved cache as 'newCache'");
    });

    it("AddCacheStrategy throws error if name format is invalid", async () => {
        const name = "/temp/fileName";
        await expect(new AddCacheStrategy().execute({ stateManager, stateCacheFile, projectPath, logger }, {}, name)).rejects.toThrow(`Invalid cache name format: '${name}'. Only alphanumeric characters with underscores or hypens are allowed.`);
    });
});
