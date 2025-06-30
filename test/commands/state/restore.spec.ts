import { expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";
import Restore from "../../../src/commands/state/restore";
import configLoaderMock from "../../../src/helpers/config-loader";
import { confirm as confirmMock } from "../../../src/helpers/user-input";
import ChsDevConfig from "../../../src/model/Config";
import { DockerCompose } from "../../../src/run/docker-compose";
import { existsSync } from "fs";
import * as yaml from "yaml";

const dockerComposeMock = {
    getServiceStatuses: jest.fn()
};

jest.mock("fs");
jest.mock("yaml");
jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/run/docker-compose");
jest.mock("../../../src/helpers/user-input");

const chsDevConfig: ChsDevConfig = {
    projectPath: "./docker-chs",
    projectName: "docker-chs",
    env: {},
    versionSpecification: "<=0.1.16"
};

describe("Restore Command", () => {
    let restore: Restore;
    let testConfig: Config;
    let cacheData: any;
    let stateCache: any;
    let parseMock: any;

    const setUpCommand = () => {

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache" };

        // @ts-expect-error
        configLoaderMock.mockReturnValue(chsDevConfig);

        // @ts-expect-error
        DockerCompose.mockReturnValue(dockerComposeMock);

        restore = new Restore([], testConfig);

        // @ts-expect-error
        parseMock = jest.spyOn(restore, "parse");

        parseMock.mockResolvedValue({
            args: { name: "cacheName" },
            flags: {
                importCacheFrom: false
            }
        });

        (confirmMock as jest.Mock).mockReturnValue(true);

        stateCache = {
            state: {
                snapshot: { foo: "bar" },
                hash: jest.spyOn(restore as any, "hash").mockReturnValue(yaml.stringify({ foo: "bar" }))
            },
            dockerCompose: {
                snapshot: { baz: "qux" },
                hash: jest.spyOn(restore as any, "hash").mockReturnValue(yaml.stringify({ baz: "qux" }))
            }
        };
        cacheData = { cacheName: stateCache };
    };

    beforeEach(() => {
        jest.resetAllMocks();

        (existsSync as jest.Mock).mockReturnValue(true);
        setUpCommand();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("restoreFromSavedCache", () => {

        it("should restore state from saved cache", () => {
            jest.spyOn(restore as any, "loadSavedCacheData").mockReturnValue(cacheData);
            const verifySpy = jest.spyOn(restore as any, "verifyCacheAuthencity").mockReturnValue(stateCache);
            const restoreStateSpy = jest.spyOn(restore as any, "restoreState").mockImplementation(() => {});
            const logSpy = jest.spyOn(restore, "log").mockImplementation(() => {});

            (restore as any).restoreFromSavedCache("cacheName");

            expect(verifySpy).toHaveBeenCalledWith(stateCache, expect.any(Function));
            expect(restoreStateSpy).toHaveBeenCalledWith(stateCache);
            expect(logSpy).toHaveBeenCalledWith("Restored state from saved cache 'cacheName'");
        });

        it("should error if cache not found", () => {
            jest.spyOn(restore as any, "loadSavedCacheData").mockReturnValue({});
            const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("err"); });

            expect(() => (restore as any).restoreFromSavedCache("missing")).toThrow("err");
            expect(errorSpy).toHaveBeenCalledWith("Cache with name 'missing' not found.");
        });
    });

    describe("restoreFromImport", () => {

        it("should restore state from imported cache", () => {
            jest.spyOn(restore as any, "parseYamlFile").mockReturnValue(stateCache);
            const verifySpy = jest.spyOn(restore as any, "verifyCacheAuthencity").mockReturnValue(stateCache);
            const restoreStateSpy = jest.spyOn(restore as any, "restoreState").mockImplementation(() => {});
            const logSpy = jest.spyOn(restore, "log").mockImplementation(() => {});

            (restore as any).restoreFromImport("/import/path.yaml");

            expect(verifySpy).toHaveBeenCalledWith(stateCache, expect.any(Function));
            expect(restoreStateSpy).toHaveBeenCalledWith(stateCache);
            expect(logSpy).toHaveBeenCalledWith("Restored state from imported cache.");
        });

        it("should error if import file does not exist", () => {
            (existsSync as jest.Mock).mockReturnValue(false);
            const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("err"); });
            expect(() => (restore as any).restoreFromImport("/bad/path.yaml")).toThrow("err");
            expect(errorSpy).toHaveBeenCalledWith("Import cache file does not exist in location: /bad/path.yaml");
        });

        it("should error if imported cache data is invalid", () => {
            (existsSync as jest.Mock).mockReturnValue(true);
            jest.spyOn(restore as any, "parseYamlFile").mockReturnValue(undefined);
            const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("err"); });
            expect(() => (restore as any).restoreFromImport("/import/path.yaml")).toThrow("err");
            expect(errorSpy).toHaveBeenCalledWith("Invalid cache data in imported file: /import/path.yaml");
        });
    });

    describe("verifyCacheAuthencity", () => {
        it("should error if hashes do not match", () => {
            const badCache = {
                state: { snapshot: { foo: "bar" }, hash: "bad" },
                dockerCompose: { snapshot: { baz: "qux" }, hash: "bad" }
            };
            const errorSpy = jest.spyOn(restore, "error").mockImplementation(() => { throw new Error("err"); });
            expect(() => (restore as any).verifyCacheAuthencity(badCache, (c: any) => c)).toThrow("err");
            expect(errorSpy).toHaveBeenCalledWith("Cache data has been corrupted or touched.");
        });
    });

});
