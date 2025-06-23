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
    versionSpecification: "<=0.1.16"
};

const DOCUMENTATION_LINK = "https://www.github.com/companieshouse/chs-dev/blob/main/docs/troubleshooting-remedies/correctly-resolve-breaking-changes-from-version-migrations.md";

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
        satisfies: satisfiesMock,
        eq: (a: string, b: string) => a === b,
        gt: (a: string, b: string) => {
            const pa = a.split(".").map(Number);
            const pb = b.split(".").map(Number);
            for (let i = 0; i < 3; i++) {
                if (pa[i] > pb[i]) return true;
                if (pa[i] < pb[i]) return false;
            }
            return false;
        },
        major: (v: string) => Number(v.split(".")[0]),
        minor: (v: string) => Number(v.split(".")[1]),
        patch: (v: string) => Number(v.split(".")[2])
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

    it("runs synchronisation and notify user when version is a major upgrade or downgrade ", async () => {
        const logSpy = jest.spyOn(sync, "log");
        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                version: "2.1.2",
                force: true
            }
        });

        await sync.run();

        expect(runSynchronisationMock).toHaveBeenCalledWith(true, "2.1.2");
        expect(logSpy).toHaveBeenCalledWith(`Major upgrade detected. Potential breaking changes — refer to the guide: ${DOCUMENTATION_LINK}.`);

    });

    describe("getVersionChangeType", () => {
        it("returns 'same' for identical versions", () => {

            expect((sync as any).getVersionChangeType("1.2.3", "1.2.3")).toBe("same");
        });

        it("detects major upgrade", () => {
            expect((sync as any).getVersionChangeType("1.2.3", "2.0.0")).toBe("major-upgrade");
        });

        it("detects major downgrade", () => {
            expect((sync as any).getVersionChangeType("2.0.0", "1.2.3")).toBe("major-downgrade");
        });

        it("detects minor upgrade", () => {
            expect((sync as any).getVersionChangeType("1.2.3", "1.3.0")).toBe("minor-upgrade");
        });

        it("detects minor downgrade", () => {
            expect((sync as any).getVersionChangeType("1.3.0", "1.2.3")).toBe("minor-downgrade");
        });

        it("detects patch upgrade", () => {
            expect((sync as any).getVersionChangeType("1.2.3", "1.2.4")).toBe("patch-upgrade");
        });

        it("detects patch downgrade", () => {
            expect((sync as any).getVersionChangeType("1.2.4", "1.2.3")).toBe("patch-downgrade");
        });
    });
});
