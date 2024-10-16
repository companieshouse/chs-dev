import { expect, jest } from "@jest/globals";
import Config from "../../src/model/Config";
import { VersionCheck } from "../../src/run/version-check";
import { getLatestReleaseVersion as getLatestReleaseVersionMock } from "../../src/helpers/latest-release";
import { timeWithinThreshold as timeWithinThresholdMock } from "../../src/helpers/time-within-threshold";
import fs from "fs";
import { join } from "path";

jest.mock("../../src/helpers/latest-release");
jest.mock("../../src/helpers/time-within-threshold");

describe("VersionCheck", () => {

    const projectConfig: Config = {
        env: {},
        projectPath: "./docker-project",
        projectName: "docker-project",
        versionSpecification: ">=1.0.0 <2.0.0"
    };
    const loggerMock = {
        warn: jest.fn(),
        info: jest.fn()
    };
    const runThresholdDays = 14;

    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    const mkdirSyncSpy = jest.spyOn(fs, "mkdirSync");
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    const readFileSyncSpy = jest.spyOn(fs, "readFileSync");

    const dataDir: string = "data/";

    const version = "1.1.1";

    const differentVersionTestCases = [
        ["1.1.2", `📣 There is a newer version (1.1.2) available (current version: ${version})`],
        ["1.2.0", `📣 There is a newer minor version (1.2.0) available (current version: ${version})`],
        ["1.2.1", `📣 There is a newer minor version (1.2.1) available (current version: ${version})`],
        ["2.0.0", `📣 There is a newer major version (2.0.0) available (current version: ${version})`],
        ["2.0.1", `📣 There is a newer major version (2.0.1) available (current version: ${version})`],
        ["2.1.0", `📣 There is a newer major version (2.1.0) available (current version: ${version})`]
    ];

    describe("create", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            mkdirSyncSpy.mockImplementation((_, __) => {
                return undefined;
            });
        });

        it("checks if data directory exists", () => {
            VersionCheck.create({
                dataDirectory: dataDir,
                logger: loggerMock,
                config: projectConfig,
                runThresholdDays
            });

            expect(existsSyncSpy).toHaveBeenCalledWith(dataDir);
        });

        it("creates data directory when does not exist already", () => {
            existsSyncSpy.mockReturnValue(false);

            VersionCheck.create({
                dataDirectory: dataDir,
                logger: loggerMock,
                config: projectConfig,
                runThresholdDays
            });

            expect(mkdirSyncSpy).toHaveBeenCalledWith(dataDir, { recursive: true });
        });

        it("does not create data directory when already present", () => {
            existsSyncSpy.mockReturnValue(true);

            VersionCheck.create({
                dataDirectory: dataDir,
                logger: loggerMock,
                config: projectConfig,
                runThresholdDays
            });

            expect(mkdirSyncSpy).not.toHaveBeenCalled();
        });

        it("returns a VersionCheck object", () => {

            existsSyncSpy.mockReturnValue(true);

            const result = VersionCheck.create({
                dataDirectory: dataDir,
                logger: loggerMock,
                config: projectConfig,
                runThresholdDays
            });

            expect(result).toBeInstanceOf(VersionCheck);
        });
    });

    describe("run", () => {
        let versionCheck: VersionCheck;

        describe("first run through", () => {
            beforeEach(() => {
                jest.resetAllMocks();

                existsSyncSpy.mockReturnValueOnce(true);

                versionCheck = VersionCheck.create({
                    dataDirectory: dataDir,
                    logger: loggerMock,
                    config: projectConfig,
                    runThresholdDays
                });

                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue(version);

                delete process.env.CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING;

                writeFileSyncSpy.mockImplementation((_, __) => { });

                existsSyncSpy.mockReturnValue(false);
            });

            it("fetches the latest version", async () => {

                await versionCheck.run(version);

                expect(getLatestReleaseVersionMock).toHaveBeenCalled();
            });

            for (const [newerVersion, expectedMessage] of differentVersionTestCases) {
                it(`displays correct message when there is newer version: ${newerVersion}`, async () => {
                    // @ts-expect-error
                    getLatestReleaseVersionMock.mockResolvedValue(newerVersion);

                    await versionCheck.run(version);

                    expect(loggerMock.info.mock.calls).toMatchSnapshot();
                });
            }

            it("displays correct message when the installed version not meeting project", async () => {
                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue("0.9.23");

                await versionCheck.run("0.9.23");

                expect(loggerMock.warn.mock.calls).toMatchSnapshot();
            });
        });

        describe("subsequent run through", () => {

            const lastRunThrough = "2024-01-01T00:00:00.000Z";

            let currentTime: Date;

            beforeEach(() => {
                jest.resetAllMocks();

                existsSyncSpy.mockReturnValue(true);

                versionCheck = VersionCheck.create({
                    dataDirectory: dataDir,
                    logger: loggerMock,
                    config: projectConfig,
                    runThresholdDays
                });

                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue(version);

                readFileSyncSpy.mockReturnValue(
                    Buffer.from(
                        lastRunThrough
                    )
                );

                const dateNowMock = jest.fn();
                dateNowMock.mockImplementation(() => currentTime.getTime());

                // @ts-expect-error
                Date.now = dateNowMock;

                delete process.env.CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING;

                writeFileSyncSpy.mockImplementation((_, __) => { });

            });

            it("checks version when after time passed", async () => {
                currentTime = new Date(2024, 0, 16, 0, 0, 0, 0);

                // @ts-expect-error
                timeWithinThresholdMock.mockReturnValue(false);

                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue(version);

                await versionCheck.run(version);

                expect(getLatestReleaseVersionMock).toHaveBeenCalled();
            });

            it("writes out current time when has checked version", async () => {
                currentTime = new Date(2024, 0, 16, 0, 0, 0, 0);

                // @ts-expect-error
                timeWithinThresholdMock.mockReturnValue(false);

                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue(version);

                await versionCheck.run(version);

                expect(writeFileSyncSpy).toHaveBeenCalledWith(
                    join(dataDir, "last-version-run-time"),
                    "2024-01-16T00:00:00.000Z"
                );
            });

            it("does not check version when time passed not passed", async () => {
                // @ts-expect-error
                timeWithinThresholdMock.mockReturnValue(true);

                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue(version);

                await versionCheck.run(version);

                expect(getLatestReleaseVersionMock).not.toHaveBeenCalled();
            });

            it("checks version when CHS_DEV_CHECK_VERSION is set", async () => {
                process.env.CHS_DEV_CHECK_VERSION = "1";

                currentTime = new Date(2024, 0, 13, 0, 0, 0, 0);

                // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue(version);

                await versionCheck.run(version);

                expect(getLatestReleaseVersionMock).toHaveBeenCalled();
            });

            it("displays correct message when the installed version not meeting project", async () => {
            // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue("0.9.23");

                await versionCheck.run("0.9.23");

                expect(loggerMock.warn.mock.calls).toMatchSnapshot();
            });

            it("does not display message when the installed version not meeting project and env var set", async () => {
            // @ts-expect-error
                getLatestReleaseVersionMock.mockResolvedValue("0.9.23");

                process.env.CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING = "true";

                await versionCheck.run("0.9.23");

                expect(loggerMock.warn).not.toHaveBeenCalled();
            });

        });

    });

});
