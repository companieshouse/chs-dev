import { expect, jest } from "@jest/globals";
import Cache from "../../../src/commands/state/cache";
import { StateManager } from "../../../src/state/state-manager";
import { Config } from "@oclif/core";
import State from "../../../src/model/State";
import ChsDevConfig from "../../../src/model/Config";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import configLoaderMock from "../../../src/helpers/config-loader";
import * as yaml from "yaml";
import { join } from "path";

jest.mock("fs");
jest.mock("yaml");
jest.mock("../../../src/state/state-manager");
jest.mock("../../../src/helpers/config-loader");

const chsDevConfig: ChsDevConfig = {
    projectPath: "./docker-chs",
    projectName: "docker-chs",
    env: {},
    versionSpecification: "<=0.1.16"
};

const stateSnapshot = {
    modules: [],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [],
    excludedServices: []
};

describe("Cache Command", () => {
    let cache: Cache;
    let testConfig: Config;

    let parseMock: any;

    const setUpCommand = (snapshot: State) => {

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache" };

        // @ts-expect-error
        StateManager.mockReturnValue({ snapshot });

        // @ts-expect-error
        configLoaderMock.mockReturnValue(chsDevConfig);

        cache = new Cache([], testConfig);

        // @ts-expect-error
        parseMock = jest.spyOn(cache, "parse");

        parseMock.mockResolvedValue({
            flags: {
                wipe: false,
                remove: false,
                available: false,
                exportCache: false
            }
        });
    };

    beforeEach(() => {
        jest.resetAllMocks();

        (existsSync as jest.Mock).mockReturnValue(true);
        setUpCommand(stateSnapshot);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("handles --wipe flag", async () => {
        parseMock.mockResolvedValue({
            flags: {
                wipe: true
            }
        });

        const handleActionSpy = jest.spyOn(cache as any, "handleActionWithPrompt").mockResolvedValue(undefined);

        await cache.run();

        expect(handleActionSpy).toHaveBeenCalledWith("Wipe", "wipe", "Wiped all caches");
    });

    it("handles --available flag", async () => {
        parseMock.mockResolvedValue({
            flags: {
                available: true
            }
        });
        const cacheActionsSpy = jest.spyOn(cache as any, "cacheActions").mockImplementation(() => {});

        await cache.run();

        expect(cacheActionsSpy).toHaveBeenCalledWith("Available", "available");
    });

    it("handles --remove flag", async () => {
        parseMock.mockResolvedValue({
            args: { name: "testcache" },
            flags: {
                remove: true
            }
        });
        const handleActionSpy = jest.spyOn(cache as any, "handleActionWithPrompt").mockResolvedValue(undefined);

        await cache.run();

        expect(handleActionSpy).toHaveBeenCalledWith("testcache", "remove", "Removed cache testcache");
    });

    it("handles --exportCache flag", async () => {
        parseMock.mockResolvedValue({
            args: { name: "testcache" },
            flags: {
                exportCache: true
            }
        });
        const cacheActionsSpy = jest.spyOn(cache as any, "cacheActions").mockImplementation(() => {});

        await cache.run();

        expect(cacheActionsSpy).toHaveBeenCalledWith("testcache", "export");
    });

    it("requires cache name if not provided and not wipe/available", async () => {
        parseMock.mockResolvedValue({
            args: {},
            flags: {
                exportCache: true
            }
        });

        const errorSpy = jest.spyOn(cache, "error").mockImplementation(
            (msg: any) => {
                throw new Error(msg);
            });

        await expect(cache.run()).rejects.toThrow("Cache name is required");
        errorSpy.mockRestore();
    });

    it("adds a cache when no flags are set", async () => {
        parseMock.mockResolvedValue({
            args: { name: "mycache" },
            flags: {}
        });
        const handleActionSpy = jest.spyOn(cache as any, "handleActionWithPrompt").mockResolvedValue(undefined);

        await cache.run();

        expect(handleActionSpy).toHaveBeenCalledWith("mycache", "add", "Saved cache as 'mycache'");
    });

    it("handleActionWithPrompt calls cacheActions and logs on confirm", async () => {
        const cacheActionsSpy = jest.spyOn(cache as any, "cacheActions").mockImplementation(() => {});
        const logSpy = jest.spyOn(cache, "log").mockImplementation(() => {});
        jest.spyOn(cache as any, "handlePrompt").mockResolvedValue(true);

        await (cache as any).handleActionWithPrompt("mycache", "add", "Saved cache as 'mycache'");

        expect(cacheActionsSpy).toHaveBeenCalledWith("mycache", "add");
        expect(logSpy).toHaveBeenCalledWith("Saved cache as 'mycache'");
    });

    it("handleActionWithPrompt does not call cacheActions if prompt is false", async () => {
        const cacheActionsSpy = jest.spyOn(cache as any, "cacheActions").mockImplementation(() => {});
        jest.spyOn(cache as any, "handlePrompt").mockResolvedValue(false);

        await (cache as any).handleActionWithPrompt("mycache", "add", "Saved cache as 'mycache'");

        expect(cacheActionsSpy).not.toHaveBeenCalled();
    });

    it("availableCaches logs available caches", () => {
        const logSpy = jest.spyOn(cache, "log").mockImplementation(() => {});
        (cache as any).availableCaches({ testcache: {}, mycache: {} });

        expect(logSpy).toHaveBeenCalledWith("Available caches:");
        expect(logSpy).toHaveBeenCalledWith("- testcache");
        expect(logSpy).toHaveBeenCalledWith("- mycache");
    });

    it("availableCaches logs when no caches", () => {
        const logSpy = jest.spyOn(cache, "log").mockImplementation(() => {});
        (cache as any).availableCaches({});

        expect(logSpy).toHaveBeenCalledWith("No cache available.");
    });

    it("exportCache writes file and logs", () => {

        const logSpy = jest.spyOn(cache, "log").mockImplementation(() => {});
        const cacheData = { foo: { some: "data" } };
        const exportDir = join(chsDevConfig.projectPath, ".exported_state_cache");
        const exportedFilename = join(exportDir, "foo.yaml");

        (existsSync as jest.Mock).mockImplementation((p) => p === exportDir);
        (mkdirSync as jest.Mock).mockImplementation(() => {});
        (writeFileSync as jest.Mock).mockImplementation(() => {});

        (cache as any).exportCache(cacheData, "foo");

        const exportData = [
            "# DO NOT MODIFY MANUALLY",
            yaml.stringify(cacheData.foo)
        ];

        expect(writeFileSync).toHaveBeenCalledWith(
            exportedFilename,
            expect.stringMatching(exportData.join("\n\n"))
        );
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining("Exported cache foo destination")
        );
    });

    it("cacheByNameExists throws error if cache does not exist", () => {

        const errorSpy = jest.spyOn(cache, "error").mockImplementation((msg: any) => { throw new Error(msg); });

        expect(() => (cache as any).cacheByNameExists({}, "bar")).toThrow("Cache named bar does not exist.");
        errorSpy.mockRestore();
    });

    it("hash returns sha256 hash", () => {
        const hash = (cache as any).hash("hello");
        expect(hash).toHaveLength(64);
    });
});
