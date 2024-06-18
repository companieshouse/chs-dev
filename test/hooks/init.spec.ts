import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Hook, IConfig } from "@oclif/config";
// @ts-expect-error
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const getLatestReleaseVersionMock = jest.fn();

jest.mock("../../src/helpers/latest-release", () => {
    return {
        getLatestReleaseVersion: getLatestReleaseVersionMock
    };
});

describe("init hook", () => {

    let tempDir: string;
    let dataDir: string;
    let testConfig: IConfig;
    let initHook: Hook<"init">;

    const version = "1.1.1";
    const differentVersionTestCases = [
        ["1.1.2", `📣 There is a newer version (1.1.2) available (current version: ${version})`],
        ["1.2.0", `📣 There is a newer minor version (1.2.0) available (current version: ${version})`],
        ["1.2.1", `📣 There is a newer minor version (1.2.1) available (current version: ${version})`],
        ["2.0.0", `📣 There is a newer major version (2.0.0) available (current version: ${version})`],
        ["2.0.1", `📣 There is a newer major version (2.0.1) available (current version: ${version})`],
        ["2.1.0", `📣 There is a newer major version (2.1.0) available (current version: ${version})`]
    ];

    const pjson = {
        "chs-dev": {
            "version-check-schedule": {
                "number-of-days": 14
            }
        }
    };

    beforeAll(async () => {

        tempDir = mkdtempSync("init-hook");

        dataDir = join(tempDir, "data");

        // @ts-expect-error
        testConfig = { root: tempDir, configDir: join(tempDir, "config"), dataDir, version, pjson };

        initHook = (await import("../../src/hooks/init")).hook;
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    describe("first run through", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            if (existsSync(dataDir)) {
                rmSync(dataDir, { force: true, recursive: true });
            }

            // @ts-expect-error
            getLatestReleaseVersionMock.mockResolvedValue(version);
        });

        it("should make data dir when not already in existence", async () => {
            expect(existsSync(dataDir)).toBe(false);

            // @ts-expect-error
            await initHook({
                config: testConfig,
                id: "",
                argv: [],
                context: jest.fn()
            });

            expect(existsSync(dataDir)).toBe(true);
        });

        it("fetches the latest version", async () => {
            // @ts-expect-error
            await initHook({
                config: testConfig,
                id: "",
                argv: [],
                context: jest.fn()
            });

            expect(getLatestReleaseVersionMock).toHaveBeenCalled();
        });

        it("fetches latest version when directory but not file exists", async () => {
            mkdirSync(dataDir);

            // @ts-expect-error
            await initHook({
                config: testConfig,
                id: "",
                argv: [],
                context: jest.fn()
            });

            expect(getLatestReleaseVersionMock).toHaveBeenCalled();
        });

        for (const [newerVersion, expectedMessage] of differentVersionTestCases) {
            it(`displays correct message when there is newer version: ${newerVersion}`, async () => {
                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue(newerVersion);

                const consoleLogSpy = jest.spyOn(console, "log");

                // @ts-expect-error
                await initHook({
                    config: testConfig,
                    id: "",
                    argv: [],
                    context: jest.fn()
                });

                expect(consoleLogSpy.mock.calls).toMatchSnapshot();
            });
        }
    });

    describe("subsequent run through", () => {

        const lastRunThrough = "2024-01-01T00:00:00.000Z";

        let currentTime: Date;

        beforeEach(() => {
            jest.resetAllMocks();

            // @ts-expect-error
            getLatestReleaseVersionMock.mockResolvedValue(version);

            if (!existsSync(dataDir)) {
                mkdirSync(dataDir);
            }

            writeFileSync(
                join(dataDir, "last-version-run-time"),
                lastRunThrough
            );

            const dateNowMock = jest.fn();
            dateNowMock.mockImplementation(() => currentTime.getTime());

            // @ts-expect-error
            Date.now = dateNowMock;
        });

        it("checks version when after time passed", async () => {
            currentTime = new Date(2024, 0, 16, 0, 0, 0, 0);

            // @ts-expect-error
            getLatestReleaseVersionMock.mockResolvedValue(version);

            // @ts-expect-error
            await initHook({
                config: testConfig,
                id: "",
                argv: [],
                context: jest.fn()
            });

            expect(getLatestReleaseVersionMock).toHaveBeenCalled();
        });

        it("writes out current time when has checked version", async () => {
            currentTime = new Date(2024, 0, 16, 0, 0, 0, 0);

            // @ts-expect-error
            getLatestReleaseVersionMock.mockResolvedValue(version);

            // @ts-expect-error
            await initHook({
                config: testConfig,
                id: "",
                argv: [],
                context: jest.fn()
            });

            expect(readFileSync(join(dataDir, "last-version-run-time")).toString("utf8")).toEqual("2024-01-16T00:00:00.000Z");
        });

        it("does not check version when time passed not passed", async () => {
            currentTime = new Date(2024, 0, 13, 0, 0, 0, 0);

            // @ts-expect-error
            getLatestReleaseVersionMock.mockResolvedValue(version);

            // @ts-expect-error
            await initHook({
                config: testConfig,
                id: "",
                argv: [],
                context: jest.fn()
            });

            expect(getLatestReleaseVersionMock).not.toHaveBeenCalled();
        });

        it("checks version when CHS_DEV_CHECK_VERSION is set", async () => {
            process.env.CHS_DEV_CHECK_VERSION = "1";

            currentTime = new Date(2024, 0, 13, 0, 0, 0, 0);

            // @ts-expect-error
            getLatestReleaseVersionMock.mockResolvedValue(version);

            // @ts-expect-error
            await initHook({
                config: testConfig,
                id: "",
                argv: [],
                context: jest.fn()
            });

            expect(getLatestReleaseVersionMock).toHaveBeenCalled();
        });
    });

});
