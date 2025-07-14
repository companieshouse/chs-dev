import Cache from "../../../src/commands/state/cache";
import { Config } from "@oclif/core";
import { AddCacheStrategy, AvailableCacheStrategy, ExportCacheStrategy, RemoveCacheStrategy, WipeCacheStrategy } from "../../../src/commands/state/CacheActionStrategy";
import { readFileContent } from "../../../src/helpers/file-utils";
import { expect, jest } from "@jest/globals";

jest.mock("../../../src/helpers/file-utils");

describe("Cache Command", () => {
    let config: Config;
    let cache: Cache;
    let parseMock: any;

    beforeEach(() => {
        config = { cacheDir: "/tmp/cache" } as any;
        cache = new Cache([], config);
        parseMock = jest.spyOn(cache as any, "parse");
        jest.spyOn(cache as any, "log").mockImplementation(() => {});
        jest.spyOn(cache as any, "error").mockImplementation((msg: any) => { throw new Error(msg); });
    });

    it("should call WipeCacheStrategy when --wipe is set", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: { wipe: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const wipeSpy = jest.spyOn(WipeCacheStrategy.prototype, "execute").mockResolvedValue(undefined);
        await cache.run();
        expect(wipeSpy).toHaveBeenCalled();
    });

    it("should call AvailableCacheStrategy when --available is set", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: { available: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const availableSpy = jest.spyOn(AvailableCacheStrategy.prototype, "execute").mockReturnValue(undefined);
        await cache.run();
        expect(availableSpy).toHaveBeenCalled();
    });

    it("should throw error if cache name is missing", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: {} });
        (readFileContent as jest.Mock).mockReturnValue({});
        await expect(cache.run()).rejects.toThrow("Cache name is required");
    });

    it("should call RemoveCacheStrategy when --remove is set", async () => {
        parseMock.mockResolvedValue({ args: { name: "foo" }, flags: { remove: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const removeSpy = jest.spyOn(RemoveCacheStrategy.prototype, "execute").mockResolvedValue(undefined);
        await cache.run();
        expect(removeSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "foo");
    });

    it("should call ExportCacheStrategy when --exportCache is set", async () => {
        parseMock.mockResolvedValue({ args: { name: "foo" }, flags: { exportCache: true } });
        (readFileContent as jest.Mock).mockReturnValue({});
        const exportSpy = jest.spyOn(ExportCacheStrategy.prototype, "execute").mockResolvedValue(undefined);
        await cache.run();
        expect(exportSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "foo");
    });

    it("should call AddCacheStrategy when no special flag is set", async () => {
        parseMock.mockResolvedValue({ args: { name: "foo" }, flags: {} });
        (readFileContent as jest.Mock).mockReturnValue({});
        const addSpy = jest.spyOn(AddCacheStrategy.prototype, "execute").mockResolvedValue(undefined);
        await cache.run();
        expect(addSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "foo");
    });
});
