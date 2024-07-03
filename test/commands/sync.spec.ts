import { beforeAll, expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";
import ChsDevConfig from "../../src/model/Config";

const runSynchronisationMock = jest.fn();
const getLatestReleaseVersionMock = jest.fn();
const satisfiesMock = jest.fn();
const configLoaderMock = jest.fn();

const chsDevConfig: ChsDevConfig = {
    projectPath: "./docker-chs",
    projectName: "docker-chs",
    env: {},
    authenticatedRepositories: [],
    versionSpecification: "<=0.1.16"
};

jest.mock("../../src/run/sync-versions", function () {
    return {
        SynchronizeChsDevVersion: function () {
            return {
                run: runSynchronisationMock
            };
        }
    };
});

jest.mock("../../src/helpers/latest-release", () => {
    return {
        getLatestReleaseVersion: getLatestReleaseVersionMock
    };
});

jest.mock("../../src/helpers/config-loader", () => {
    return {
        load: configLoaderMock
    };
});

jest.mock("semver", () => {
    return {
        satisfies: satisfiesMock
    };
});

describe("Sync command", () => {

    let testConfig: Config;
    const parseMock = jest.fn();

    let Sync;
    let sync;

    beforeAll(async () => {
        ({ Sync } = (await import("../../src/commands/sync")));
    });

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        testConfig = {
            version: "0.1.13"
        };

        // @ts-expect-error
        getLatestReleaseVersionMock.mockResolvedValue("0.1.14");
        configLoaderMock.mockReturnValue(chsDevConfig);

        sync = new Sync([], testConfig);

        sync.parse = parseMock;

    });

    it("uses latest when latest when no version in config or flag", async () => {
        const chsDevConfigMinusVersion = {
            ...chsDevConfig
        };

        chsDevConfigMinusVersion.versionSpecification = undefined;

        configLoaderMock.mockReturnValue(chsDevConfigMinusVersion);

        sync = new Sync([], testConfig);

        sync.parse = parseMock;

        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                force: false
            }
        });

        await sync.run();

        expect(runSynchronisationMock).toHaveBeenCalledWith(false, "0.1.14");

    });

    it("runs synchronisation with project values when no flags supplied", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                force: false
            }
        });

        await sync.run();

        expect(runSynchronisationMock).toHaveBeenCalledWith(false, "<=0.1.16");

    });

    it("runs synchronisation with values of flags when flags supplied", async () => {
        satisfiesMock.mockReturnValue(false);

        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                version: "<=0.1.2",
                force: true
            }
        });

        await sync.run();

        expect(runSynchronisationMock).toHaveBeenCalledWith(true, "<=0.1.2");
        expect(satisfiesMock).toHaveBeenCalledWith("0.1.13", "<=0.1.2");
    });

    it("checks latest version when latest version specified", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                version: "latest",
                force: false
            }
        });

        await sync.run();

        expect(getLatestReleaseVersionMock).toHaveBeenCalledTimes(1);

    });

    it("does not check latest version when another version specified", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                version: "1.0.9",
                force: false
            }
        });

        await sync.run();

        expect(getLatestReleaseVersionMock).not.toHaveBeenCalled();
    });

    it("Does not synchronise versions when already latest version", async () => {
        const logSpy = jest.spyOn(sync, "log");

        // @ts-expect-error
        getLatestReleaseVersionMock.mockResolvedValue("0.1.13");

        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                version: "latest",
                force: false
            }
        });

        await sync.run();

        expect(runSynchronisationMock).not.toHaveBeenCalled();

        expect(logSpy).toHaveBeenCalledWith("Synchronisation complete. Version: 0.1.13 already installed");
    });
});
