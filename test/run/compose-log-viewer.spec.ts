import { expect, jest } from "@jest/globals";
import { ComposeLogViewer } from "../../src/run/compose-log-viewer";
import glob from "glob";
import fs from "fs";
import { EventEmitter, PassThrough } from "stream";
import childProcess from "child_process";

jest.mock("glob");

describe("ComposeLogViewer", () => {

    let composeLogViewer: ComposeLogViewer;
    const spawnMock = jest.spyOn(childProcess, "spawn");
    let spawnStreamMock;
    let stdoutStreamMock;
    let stderrStreamMock;
    const loggerMock = {
        log: jest.fn()
    };

    beforeEach(() => {
        jest.resetAllMocks();

        composeLogViewer = new ComposeLogViewer({
            env: {},
            projectPath: "."
        }, loggerMock);

        spawnStreamMock = new EventEmitter();
        stdoutStreamMock = new PassThrough();
        stderrStreamMock = new PassThrough();

        spawnStreamMock.stdout = stdoutStreamMock;
        spawnStreamMock.stderr = stderrStreamMock;

        spawnMock.mockReturnValue(spawnStreamMock as any);
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

            spawnStreamMock = new EventEmitter();
            stdoutStreamMock = new PassThrough();
            stderrStreamMock = new PassThrough();

            spawnStreamMock.stdout = stdoutStreamMock;
            spawnStreamMock.stderr = stderrStreamMock;

            spawnMock.mockReturnValue(spawnStreamMock as any);
        });

        it("opens the file when only one", async () => {
            // @ts-expect-error
            glob.sync.mockReturnValue([
                "local/.logs/compose.out.1716472062.txt"
            ]);

            const composeLogViewPromise = composeLogViewer.view({
                follow: true,
                tail: "all"
            });

            spawnStreamMock.emit("exit", 0);

            await composeLogViewPromise;

            expect(spawnMock).toHaveBeenCalledWith(
                "tail",
                ["-f", "--", "local/.logs/compose.out.1716472062.txt"]
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

            const composeLogViewPromise = composeLogViewer.view({
                follow: true,
                tail: "all"
            });

            spawnStreamMock.emit("exit", 0);

            await composeLogViewPromise;

            expect(spawnMock).toHaveBeenCalledWith(
                "tail",
                ["-f", "--", "local/.logs/compose.out.1716472062.txt"]
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

            const viewComposeLogsPromise = composeLogViewer.view({
                follow: true,
                tail: "all"
            });

            stdoutStreamMock.emit("data", "line 1\nline 2\n");
            stdoutStreamMock.emit("data", "line 3");
            spawnStreamMock.emit("exit", 0);

            await expect(viewComposeLogsPromise).resolves.toBeUndefined();

            expect(loggerMock.log).toHaveBeenCalledTimes(3);
            expect(loggerMock.log).toHaveBeenCalledWith("line 1");
            expect(loggerMock.log).toHaveBeenCalledWith("line 2");
            expect(loggerMock.log).toHaveBeenCalledWith("line 3");
        });

    });

    describe("non-follow", () => {
        const readFileSyncMock = jest.spyOn(fs, "readFileSync");

        beforeEach(() => {
            jest.resetAllMocks();

            spawnStreamMock = new EventEmitter();
            stdoutStreamMock = new PassThrough();
            stderrStreamMock = new PassThrough();

            spawnStreamMock.stdout = stdoutStreamMock;
            spawnStreamMock.stderr = stderrStreamMock;

            spawnMock.mockReturnValue(spawnStreamMock as any);
        });

        it("opens the file when only one", async () => {
            // @ts-expect-error
            glob.sync.mockReturnValue([
                "local/.logs/compose.out.1716472062.txt"
            ]);

            const viewPromise = composeLogViewer.view({
                follow: false,
                tail: "all"
            });

            spawnStreamMock.emit("exit", 0);

            await viewPromise;

            expect(spawnMock).toHaveBeenCalledWith(
                "cat",
                [
                    "--",
                    "local/.logs/compose.out.1716472062.txt"
                ]
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

            const viewPromise = composeLogViewer.view({
                follow: false,
                tail: "all"
            });

            spawnStreamMock.emit("exit", 0);

            await viewPromise;

            expect(spawnMock).toHaveBeenCalledWith(
                "cat",
                [
                    "--",
                    "local/.logs/compose.out.1716472062.txt"
                ]
            );
        });

        it("tails last n lines", async () => {
            // @ts-expect-error
            glob.sync.mockReturnValue([
                "local/.logs/compose.out.1716472059.txt",
                "local/.logs/compose.out.1716472062.txt",
                "local/.logs/compose.out.1716472049.txt",
                "local/.logs/compose.out.1716472039.txt"
            ]);

            const viewPromise = composeLogViewer.view({
                follow: false,
                tail: "20"
            });

            for (let lineNumber = 1; lineNumber <= 20; lineNumber++) {
                stdoutStreamMock.emit("data", `line ${lineNumber}`);
            }

            spawnStreamMock.emit("exit", 0);

            await viewPromise;

            expect(spawnMock).toHaveBeenCalledWith(
                "tail",
                [
                    "-n",
                    "20",
                    "--",
                    "local/.logs/compose.out.1716472062.txt"
                ]
            );

            expect(loggerMock.log).toBeCalledTimes(20);
        });
    });

    it("rejects when non-zero exit code", async () => {

        // @ts-expect-error
        glob.sync.mockReturnValue([
            "local/.logs/compose.out.1716472039.txt"
        ]);

        const viewPromise = composeLogViewer.view({
            follow: false,
            tail: "20"
        });

        spawnStreamMock.emit("exit", 1);

        await expect(viewPromise).rejects.toEqual(new Error("Process exited with exit code: 1"));
    });

    it("rejects when error", async () => {

        // @ts-expect-error
        glob.sync.mockReturnValue([
            "local/.logs/compose.out.1716472039.txt"
        ]);

        const viewPromise = composeLogViewer.view({
            follow: false,
            tail: "20"
        });

        spawnStreamMock.emit("error", new Error("an error"));

        await expect(viewPromise).rejects.toEqual(new Error("an error"));
    });

    it("logs stderror with ERROR: prefix", async () => {

        // @ts-expect-error
        glob.sync.mockReturnValue([
            "local/.logs/compose.out.1716472039.txt"
        ]);

        const viewPromise = composeLogViewer.view({
            follow: false,
            tail: "20"
        });

        stderrStreamMock.emit("data", "some data from stderr");

        spawnStreamMock.emit("error", new Error("an error"));

        await expect(viewPromise).rejects.toEqual(new Error("an error"));

        expect(loggerMock.log).toHaveBeenCalledWith("ERROR:\tsome data from stderr");
    });
});
