import { expect, jest } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import { SynchronizeChsDevVersion } from "../../src/run/sync-versions";
import { join } from "path";
import { getLatestReleaseSatisfying } from "../../src/helpers/latest-release";
import { spawn } from "../../src/helpers/spawn-promise";
import LogEverythingLogHandler from "../../src/run/logs/LogEverythingLogHandler";

const fetchMock = jest.fn();

jest.mock("../../src/helpers/latest-release");
jest.mock("../../src/helpers/spawn-promise");

// @ts-expect-error
global.fetch = fetchMock;

describe("SynchronizeChsDevVersion", () => {
    const tempDirPath = "/tmp/temp-dir/";
    const mktempdSyncSpy = jest.spyOn(fs, "mkdtempSync");
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    const rmSyncSpy = jest.spyOn(fs, "rmSync");
    let syncVersions: SynchronizeChsDevVersion;

    describe("run", () => {
        const mockStdout = jest.fn();
        const mockSterr = jest.fn();
        const mockOnce = jest.fn();

        const installationScript = "#!/bin/bash\necho 'install me'";

        beforeEach(() => {
            jest.resetAllMocks();

            mktempdSyncSpy.mockReturnValue(tempDirPath);
            rmSyncSpy.mockReturnValue(undefined);
            writeFileSyncSpy.mockImplementation((fl, dat, _) => {});

            // @ts-expect-error
            fetchMock.mockResolvedValue({
                text: () => Promise.resolve(installationScript)
            });

            mockOnce.mockImplementation((event, listener) => {
                // @ts-expect-error
                listener(0);
            });
            syncVersions = new SynchronizeChsDevVersion();
        });

        it("creates own temporary directory to store installation script", async () => {

            await syncVersions.run(false, "latest");

            expect(mktempdSyncSpy).toHaveBeenCalled();
        });

        it("removes temporary directory", async () => {
            await syncVersions.run(false, "latest");

            expect(rmSyncSpy).toHaveBeenCalledWith(tempDirPath, {
                force: true,
                recursive: true
            });
        });

        it("removes temporary directory when installation fails", async () => {
            // @ts-expect-error
            spawn.mockRejectedValue(1);

            await expect(syncVersions.run(false, "latest")).rejects.toBeDefined();

            expect(rmSyncSpy).toHaveBeenCalledWith(tempDirPath, {
                force: true,
                recursive: true
            });
        });

        it("fetches installation script", async () => {
            await syncVersions.run(false, "latest");

            expect(fetchMock).toHaveBeenCalledWith("https://raw.githubusercontent.com/companieshouse/chs-dev/main/install.sh");
        });

        it("persists installation script", async () => {
            await syncVersions.run(false, "latest");

            expect(writeFileSyncSpy).toHaveBeenCalledWith(
                join(tempDirPath, "install.sh"),
                installationScript
            );
        });

        it("runs bash script without flags when force and version not specified", async () => {
            await syncVersions.run(false, "latest");

            expect(spawn).toHaveBeenCalledWith(
                "bash",
                [
                    join(tempDirPath, "install.sh")
                ], {
                    logHandler: expect.any(LogEverythingLogHandler)
                }
            );
        });

        const flagTestCases: [boolean, string, string[]][] = [
            [true, "latest", ["-f"]],
            [false, "0.1.1", ["-v", "0.1.1"]],
            [true, "0.1.21", ["-f", "-v", "0.1.21"]]
        ];

        for (const [force, version, expectedArgs] of flagTestCases) {
            it(`runs bash script with correct flags force=${force} version=${version}`, async () => {
                await syncVersions.run(force, version);

                expect(spawn).toHaveBeenCalledWith(
                    "bash",
                    [
                        join(tempDirPath, "install.sh"),
                        ...expectedArgs
                    ], {
                        logHandler: expect.any(LogEverythingLogHandler)
                    }
                );
            });
        }

        for (const [_, version, __] of flagTestCases) {
            it(`does not call getLatestReleaseSatisfying when version ${version} is not range`, async () => {
                await syncVersions.run(false, version);

                expect(getLatestReleaseSatisfying).not.toHaveBeenCalled();
            });
        }

        it("resolves to version installed", async () => {
            await expect(syncVersions.run(false, "1.0.0")).resolves.toBe("1.0.0");
        });

        describe("sync with range", () => {

            const rangeTestCases = [
                [">1.0.0 <2.0.0"],
                [">1.0.0"],
                [">1.10.1000"],
                [">1.10.1000 <=1.239.9"],
                ["1.10.1000 <=1.239.9"],
                ["!1.10.1000 <=1.239.9"]
            ];

            beforeEach(() => {
                jest.resetAllMocks();

                mktempdSyncSpy.mockReturnValue(tempDirPath);
                rmSyncSpy.mockReturnValue(undefined);
                writeFileSyncSpy.mockImplementation((fl, dat, _) => {});

                // @ts-expect-error
                fetchMock.mockResolvedValue({
                    text: () => Promise.resolve(installationScript)
                });

                mockOnce.mockImplementation((event, listener) => {
                    // @ts-expect-error
                    listener(0);
                });
                syncVersions = new SynchronizeChsDevVersion();

                // @ts-expect-error
                getLatestReleaseSatisfying.mockResolvedValue("1.1.9");
            });

            for (const [versionRange] of rangeTestCases) {
                it(`finds version when supplied a range (${versionRange})`, async () => {
                    await syncVersions.run(false, versionRange);

                    expect(getLatestReleaseSatisfying).toHaveBeenCalledWith(versionRange);
                });
            }

            it("installs satisfactory version when found", async () => {
                await syncVersions.run(false, ">1.0.0");

                expect(spawn).toHaveBeenCalledWith(
                    "bash",
                    [
                        join(tempDirPath, "install.sh"),
                        "-v",
                        "1.1.9"
                    ], {
                        logHandler: expect.any(LogEverythingLogHandler)
                    }
                );
            });

            it("rejects when there is not a satisfactory version", async () => {
                // @ts-expect-error
                getLatestReleaseSatisfying.mockResolvedValue(undefined);

                await expect(syncVersions.run(false, ">1.0.0")).rejects.toEqual(
                    new Error("Could not find a version of chs-dev that satisfies: >1.0.0")
                );

            });

            it("resolves to version installed", async () => {
                await expect(syncVersions.run(false, ">1.0.0")).resolves.toBe("1.1.9");
            });
        });
    });
});
