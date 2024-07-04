import { beforeAll, expect, jest } from "@jest/globals";
import glob from "glob";
import LogEverythingLogHandler from "../../src/run/logs/LogEverythingLogHandler";

jest.mock("glob");

describe("ComposeLogViewer", () => {

    const spawnMock = jest.fn();

    const loggerMock = {
        log: jest.fn()
    };

    jest.mock("../../src/helpers/spawn-promise", () => {
        return {
            spawn: spawnMock
        };
    });

    let ComposeLogViewer;
    let composeLogViewer;

    beforeAll(async () => {
        ({ ComposeLogViewer } = await import("../../src/run/compose-log-viewer"));
    });

    beforeEach(() => {
        jest.resetAllMocks();

        composeLogViewer = new ComposeLogViewer({
            env: {},
            projectPath: ".",
            authenticatedRepositories: [],
            projectName: "docker-chs"
        }, loggerMock);

        spawnMock.mockResolvedValue(undefined as never);
    });

    it("rejects when there are no log files", async () => {
        // @ts-expect-error
        glob.sync.mockReturnValue([]);

        await expect(composeLogViewer.view({
            follow: false,
            tail: "all"
        })).rejects.toBeInstanceOf(Error);
    });

    it("searches for log files in correct place", async () => {
        // @ts-expect-error
        glob.sync.mockReturnValue([]);

        await expect(composeLogViewer.view({
            follow: false,
            tail: "all"
        })).rejects.toBeInstanceOf(Error);

        expect(glob.sync).toHaveBeenCalledWith("local/.logs/*.txt");
    });

    describe("follow", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            spawnMock.mockResolvedValue(undefined as never);
        });

        it("opens the file when only one", async () => {
            // @ts-expect-error
            glob.sync.mockReturnValue([
                "local/.logs/compose.out.1716472062.txt"
            ]);

            await composeLogViewer.view({
                follow: true,
                tail: "all"
            });

            expect(spawnMock).toHaveBeenCalledWith(
                "tail",
                ["-f", "--", "local/.logs/compose.out.1716472062.txt"],
                {
                    logHandler: expect.any(LogEverythingLogHandler),
                    stderrLogHandler: expect.any(LogEverythingLogHandler)
                }
            );
        });

        it("loads the most recent one when multiple", async () => {

            // @ts-expect-error
            glob.sync.mockReturnValue([
                "local/.logs/compose.out.1716472059.txt",
                "local/.logs/compose.out.1716472062.txt",
                "local/.logs/compose.out.1716472049.txt",
                "local/.logs/compose.out.1716472039.txt"
            ]);

            await composeLogViewer.view({
                follow: true,
                tail: "all"
            });

            expect(spawnMock).toHaveBeenCalledWith(
                "tail",
                ["-f", "--", "local/.logs/compose.out.1716472062.txt"],
                {
                    logHandler: expect.any(LogEverythingLogHandler),
                    stderrLogHandler: expect.any(LogEverythingLogHandler)
                }
            );
        });

    });

    describe("non-follow", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            spawnMock.mockResolvedValue(undefined as never);
        });

        it("opens the file when only one", async () => {
            // @ts-expect-error
            glob.sync.mockReturnValue([
                "local/.logs/compose.out.1716472062.txt"
            ]);

            await composeLogViewer.view({
                follow: false,
                tail: "all"
            });

            expect(spawnMock).toHaveBeenCalledWith(
                "cat",
                [
                    "--",
                    "local/.logs/compose.out.1716472062.txt"
                ], {
                    logHandler: expect.any(LogEverythingLogHandler),
                    stderrLogHandler: expect.any(LogEverythingLogHandler)
                }
            );
        });

        it("resolves and logs file contents", async () => {
            // @ts-expect-error
            glob.sync.mockReturnValue([
                "local/.logs/compose.out.1716472059.txt",
                "local/.logs/compose.out.1716472062.txt",
                "local/.logs/compose.out.1716472049.txt",
                "local/.logs/compose.out.1716472039.txt"
            ]);

            await composeLogViewer.view({
                follow: false,
                tail: "all"
            });

            expect(spawnMock).toHaveBeenCalledWith(
                "cat",
                [
                    "--",
                    "local/.logs/compose.out.1716472062.txt"
                ], {
                    logHandler: expect.any(LogEverythingLogHandler),
                    stderrLogHandler: expect.any(LogEverythingLogHandler)
                }
            );
        });
    });

    it("rejects when non-zero exit code", async () => {

        // @ts-expect-error
        glob.sync.mockReturnValue([
            "local/.logs/compose.out.1716472039.txt"
        ]);

        spawnMock.mockRejectedValue(1 as never);

        await expect(composeLogViewer.view({
            follow: false,
            tail: "20"
        })).rejects.toEqual(new Error("Process exited with exit code: 1"));
    });

    it("rejects when error", async () => {

        // @ts-expect-error
        glob.sync.mockReturnValue([
            "local/.logs/compose.out.1716472039.txt"
        ]);

        spawnMock.mockRejectedValue(new Error("an error") as never);

        await expect(composeLogViewer.view({
            follow: false,
            tail: "20"
        })).rejects.toEqual(new Error("an error"));
    });

});
