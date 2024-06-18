import { expect, jest } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import { SynchronizeChsDevVersion } from "../../src/run/sync-versions";
import { join } from "path";

const fetchMock = jest.fn();

// @ts-expect-error
global.fetch = fetchMock;

describe("SynchronizeChsDevVersion", () => {
    const spawnMock = jest.spyOn(childProcess, "spawn");
    const tempDirPath = "/tmp/temp-dir/";
    const mktempdSyncSpy = jest.spyOn(fs, "mkdtempSync");
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    // @ts-expect-error
    const rmSyncSpy = jest.spyOn(fs, "rmSync");
    let syncVersions: SynchronizeChsDevVersion;

    describe("run", () => {
        const mockStdout = jest.fn();
        const mockSterr = jest.fn();
        const mockOnce = jest.fn();

        const installationScript = "#!/bin/bash\necho 'install me'";

        beforeEach(() => {
            jest.resetAllMocks();

            spawnMock.mockReturnValue({
                // @ts-expect-error
                stdout: { on: mockStdout },
                // @ts-expect-error
                stderr: { on: mockSterr },
                // @ts-expect-error
                once: mockOnce
            });

            mktempdSyncSpy.mockReturnValue(tempDirPath);
            // @ts-expect-error
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
            mockOnce.mockImplementation((action, listener) => {
                // @ts-expect-error
                listener(1);
            });

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

            expect(spawnMock).toHaveBeenCalledWith(
                "bash",
                [
                    join(tempDirPath, "install.sh")
                ]
            );
        });

        const flagTestCases: [boolean, string, string[]][] = [
            [true, "latest", ["--", "-f"]],
            [false, "0.1.1", ["--", "-v", "0.1.1"]],
            [true, "0.1.21", ["--", "-f", "-v", "0.1.21"]]
        ];

        for (const [force, version, expectedArgs] of flagTestCases) {
            it(`runs bash script with correct flags force=${force} version=${version}`, async () => {
                await syncVersions.run(force, version);

                expect(spawnMock).toHaveBeenCalledWith(
                    "bash",
                    [
                        join(tempDirPath, "install.sh"),
                        ...expectedArgs
                    ]
                );
            });
        }

        it("logs data received from stdout", async () => {
            const consoleLogSpy = jest.spyOn(console, "log");

            mockStdout.mockImplementation((_, listener) => {
                // @ts-expect-error
                listener("Some data");
            });

            await syncVersions.run(false, "latest");

            expect(consoleLogSpy).toHaveBeenCalledWith("Some data");

        });

        it("logs data received from stderr", async () => {
            const consoleErrSpy = jest.spyOn(console, "error");

            mockSterr.mockImplementation((_, listener) => {
                // @ts-expect-error
                listener("Some data");
            });

            await syncVersions.run(false, "latest");

            expect(consoleErrSpy).toHaveBeenCalledWith("Some data");

        });
    });
});
