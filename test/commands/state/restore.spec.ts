import { expect, jest } from "@jest/globals";
import Restore from "../../../src/commands/state/restore";
import * as stateCacheUtils from "../../../src/commands/state/state-cache-utils";
import * as fileUtils from "../../../src/helpers/file-utils";
import { DockerCompose } from "../../../src/run/docker-compose";

const dockerComposeMock = {
    getServiceStatuses: jest.fn(),
    prune: jest.fn()
};

jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/run/docker-compose");

describe("Restore Command", () => {
    let restore: Restore;
    let config: any;
    let chsDevConfig: any;
    let parseMock;

    beforeEach(() => {
        config = {
            cacheDir: "/tmp",
            root: "",
            configDir: "",
            runHook: jest.fn()
        };
        chsDevConfig = {
            projectName: "test",
            projectPath: "",
            env: {},
            versionSpecification: ""
        };
        // @ts-expect-error
        DockerCompose.mockReturnValue(dockerComposeMock);

        jest.spyOn(stateCacheUtils, "handlePrompt").mockResolvedValue(true);
        jest.spyOn(stateCacheUtils, "validateCacheNameExists").mockImplementation(() => {});
        jest.spyOn(stateCacheUtils, "verifyCacheAuthenticity").mockImplementation((data) => data);
        jest.spyOn(stateCacheUtils, "restoreStateFiles").mockImplementation(() => {});
        jest.spyOn(fileUtils, "readFileContent").mockImplementation(() => ({ testCache: { state: {}, dockerCompose: {} } }));
        jest.spyOn(stateCacheUtils, "loadImportCache").mockImplementation(() => ({
            state: {
                snapshot: {},
                hash: "testHash"
            },
            dockerCompose: {
                snapshot: {},
                hash: "testHash"
            }
        }));
        jest.spyOn(require("../../../src/helpers/config-loader"), "default").mockReturnValue(chsDevConfig);
        restore = new Restore([], config);
        // @ts-expect-error
        parseMock = jest.spyOn(restore, "parse");

        parseMock.mockResolvedValue({
            args: {}, flags: {}
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.resetAllMocks();
    });

    it("should error if containers are running", async () => {
        dockerComposeMock.getServiceStatuses.mockReturnValue({ serviceA: "running" });
        const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("Containers running"); });
        await expect(restore.run()).rejects.toThrow("Containers running");
        expect(errorSpy).toHaveBeenCalledWith("Ensure all containers are stopped. Run: '$ chs-dev down'");
    });

    it("should restore from imported cache if flag is provided and confirmed", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: { importCacheFrom: "/import/path.yaml" } });
        const restoreSpy = jest.spyOn(restore as any, "restoreFromImport").mockImplementation(() => {});
        await restore.run();
        expect(restoreSpy).toHaveBeenCalledWith("/import/path.yaml");
    });

    it("should restore from saved cache if cache name is provided and confirmed", async () => {
        parseMock.mockResolvedValue({ args: { name: "testCache" }, flags: {} });
        const restoreSpy = jest.spyOn(restore as any, "restoreFromSavedCache").mockImplementation(() => {});
        await restore.run();
        expect(restoreSpy).toHaveBeenCalledWith(expect.any(Object), "testCache");
    });

    it("should error if neither cache name nor import flag is provided", async () => {
        parseMock.mockResolvedValue({ args: {}, flags: {} });
        const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("Invalid input"); });
        await expect(restore.run()).rejects.toThrow("Invalid input");
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Please provide a valid cache name"));
    });

    it("should call restoreStateFiles and log on restoreFromSavedCache", () => {
        const cacheData = { testCache: { state: {}, dockerCompose: {} } };
        const logSpy = jest.spyOn(restore, "log").mockImplementation(() => {});
        (restore as any).restoreFromSavedCache(cacheData, "testCache");
        expect(stateCacheUtils.restoreStateFiles).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith("Restored state from saved cache 'testCache'");
    });

    it("should call restoreStateFiles and log on restoreFromImport", () => {
        const logSpy = jest.spyOn(restore, "log").mockImplementation(() => {});
        (restore as any).restoreFromImport("/import/path.yaml");
        expect(stateCacheUtils.restoreStateFiles).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith("Restored state from imported cache.");
    });

    it("should error on restoreFromSavedCache if cache name is missing", () => {
        const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("Missing cache"); });
        expect(() => (restore as any).restoreFromSavedCache({}, "missing")).toThrow("Missing cache");
        expect(errorSpy).toHaveBeenCalled();
    });

    it("should error on restoreFromImport if import fails", () => {
        jest.spyOn(stateCacheUtils, "loadImportCache").mockImplementation(() => { throw new Error("Import failed"); });
        const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("Import failed"); });
        expect(() => (restore as any).restoreFromImport("/bad/path.yaml")).toThrow("Import failed");
        expect(errorSpy).toHaveBeenCalled();
    });
});
