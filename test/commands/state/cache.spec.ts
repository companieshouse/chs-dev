import Cache from "../../../src/commands/state/cache";
import { Config } from "@oclif/core";
import { existsSync, mkdirSync } from "fs";
import loadConfig from "../../../src/helpers/config-loader";
import { readFileContent } from "../../../src/helpers/file-utils";
import { AddCacheStrategy, AvailableCacheStrategy, ExportCacheStrategy, RemoveCacheStrategy, WipeCacheStrategy } from "../../../src/commands/state/CacheActionStrategy";
import { expect, jest } from "@jest/globals";

jest.mock("fs");
jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/helpers/file-utils");
jest.mock("../../../src/state/state-manager");
jest.mock("../../../src/commands/state/CacheActionStrategy");

describe("Cache Command", () => {
    let config: Config;
    let cache: Cache;
    let parseMock: any;

    beforeEach(() => {
        config = { cacheDir: "/tmp/cache" } as any;
        (loadConfig as jest.Mock).mockReturnValue({ projectName: "proj", projectPath: "/proj" });
        (existsSync as jest.Mock).mockReturnValue(false);
        cache = new Cache([], config);
        parseMock = jest.spyOn(cache as any, "parse");
    });

    it("should create cache directory if it does not exist", () => {
        expect(mkdirSync).toHaveBeenCalledWith("/tmp/cache", { recursive: true });
    });

    it("should call WipeCacheStrategy if --wipe is set", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: { wipe: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const wipeSpy = jest.spyOn(WipeCacheStrategy.prototype, "execute").mockResolvedValue(undefined);

        await cache.run();

        expect(wipeSpy).toHaveBeenCalled();
    });

    it("should call AvailableCacheStrategy if --available is set", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: { available: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const availableSpy = jest.spyOn(AvailableCacheStrategy.prototype as any, "execute").mockImplementation(() => {});

        await cache.run();

        expect(availableSpy).toHaveBeenCalled();
    });

    it("should throw error if cache name is missing and not wipe/available", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: {} });
        (readFileContent as jest.Mock).mockReturnValue({});
        const errorSpy = jest.spyOn(cache as any, "error").mockImplementation(
            (msg: any) => {
                throw new Error(msg);

            });

        await expect(cache.run()).rejects.toThrow("Cache name is required");
        errorSpy.mockRestore();
    });

    it("should call RemoveCacheStrategy if --remove is set", async () => {
        parseMock.mockResolvedValue({ args: { name: "foo" }, flags: { remove: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const removeSpy = jest.spyOn(RemoveCacheStrategy.prototype, "execute").mockResolvedValue(undefined);

        await cache.run();

        expect(removeSpy).toHaveBeenCalledWith(cache, {}, "foo");
    });

    it("should call ExportCacheStrategy if --exportCache is set", async () => {
        parseMock.mockResolvedValue({ args: { name: "foo" }, flags: { exportCache: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const exportSpy = jest.spyOn(ExportCacheStrategy.prototype, "execute").mockResolvedValue(undefined);

        await cache.run();

        expect(exportSpy).toHaveBeenCalledWith(cache, {}, "foo");
    });

    it("should call AddCacheStrategy if no special flag is set", async () => {
        parseMock.mockResolvedValue({ args: { name: "foo" }, flags: {} });
        (readFileContent as jest.Mock).mockReturnValue({});
        const addSpy = jest.spyOn(AddCacheStrategy.prototype, "execute").mockResolvedValue(undefined);

        await cache.run();

        expect(addSpy).toHaveBeenCalledWith(cache, {}, "foo");
    });
});
