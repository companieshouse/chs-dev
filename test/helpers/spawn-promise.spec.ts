import { expect, jest } from "@jest/globals";
import childProcess, { SpawnOptions } from "child_process";
import { EventEmitter, PassThrough } from "stream";
import { spawn } from "../../src/helpers/spawn-promise";

describe("spawn", () => {
    const spawnSpy = jest.spyOn(childProcess, "spawn");

    let spawnStreamMock;
    let stdoutStreamMock;
    let stderrStreamMock;

    const logHandlerMock = {
        handle: jest.fn()
    };

    const stderrLogHandlerMock = {
        handle: jest.fn()
    };

    beforeEach(() => {
        jest.resetAllMocks();

        spawnStreamMock = new EventEmitter();
        stdoutStreamMock = new PassThrough();
        stderrStreamMock = new PassThrough();

        spawnStreamMock.stdout = stdoutStreamMock;
        spawnStreamMock.stderr = stderrStreamMock;

        spawnSpy.mockReturnValue(spawnStreamMock as any);
    });

    const acceptableExitCodes = [0, 10, 100];

    for (const acceptableCode of acceptableExitCodes) {

        it(`resolves when exit acceptable code (${acceptableCode})`, async () => {
            const spawnPromise = spawn(
                "ls",
                ["-la"],
                {
                    logHandler: logHandlerMock,
                    acceptableExitCodes
                }
            );

            spawnStreamMock.emit("exit", acceptableCode);

            await expect(spawnPromise).resolves.toBeUndefined();
        });
    }

    it("rejects with error code when code is not acceptable", async () => {
        const spawnPromise = spawn(
            "ls",
            ["-la"],
            {
                logHandler: logHandlerMock,
                acceptableExitCodes
            }
        );

        spawnStreamMock.emit("exit", 1);

        await expect(spawnPromise).rejects.toBe(1);
    });

    it("executes spawn correctly - when supplied with spawnOptions", async () => {
        const spawnOptions: SpawnOptions = {
            env: {
                ENV_ONE: "yes"
            }
        };

        const spawnPromise = spawn(
            "ls",
            ["-la"],
            {
                logHandler: logHandlerMock,
                acceptableExitCodes,
                spawnOptions
            }
        );

        spawnStreamMock.emit("exit", 0);

        await spawnPromise;

        expect(spawnSpy).toHaveBeenCalledWith(
            "ls",
            ["-la"],
            spawnOptions
        );
    });

    it("logs stdout to handler", async () => {

        const spawnPromise = spawn(
            "ls",
            ["-la"],
            {
                logHandler: logHandlerMock,
                acceptableExitCodes
            }
        );

        stdoutStreamMock.emit("data", "line 1\nline 2\n");
        stdoutStreamMock.emit("data", "line 3");

        spawnStreamMock.emit("exit", 0);

        await spawnPromise;

        expect(logHandlerMock.handle).toHaveBeenCalledTimes(2);
        expect(logHandlerMock.handle).toHaveBeenCalledWith("line 1\nline 2\n");
        expect(logHandlerMock.handle).toHaveBeenCalledWith("line 3");
    });

    it("logs stderr to same handler as stdout when not supplied", async () => {

        const spawnPromise = spawn(
            "ls",
            ["-la"],
            {
                logHandler: logHandlerMock,
                acceptableExitCodes
            }
        );

        stderrStreamMock.emit("data", "line 1\nline 2\n");
        stderrStreamMock.emit("data", "line 3");

        spawnStreamMock.emit("exit", 0);

        await spawnPromise;

        expect(logHandlerMock.handle).toHaveBeenCalledTimes(2);
        expect(logHandlerMock.handle).toHaveBeenCalledWith("line 1\nline 2\n");
        expect(logHandlerMock.handle).toHaveBeenCalledWith("line 3");
    });

    it("logs stderr to stderr handler as stdout when supplied", async () => {

        const spawnPromise = spawn(
            "ls",
            ["-la"],
            {
                logHandler: logHandlerMock,
                stderrLogHandler: stderrLogHandlerMock,
                acceptableExitCodes
            }
        );

        stderrStreamMock.emit("data", "line 1\nline 2\n");
        stderrStreamMock.emit("data", "line 3");

        spawnStreamMock.emit("exit", 0);

        await spawnPromise;

        expect(logHandlerMock.handle).not.toHaveBeenCalled();
        expect(stderrLogHandlerMock.handle).toHaveBeenCalledTimes(2);
        expect(stderrLogHandlerMock.handle).toHaveBeenCalledWith("line 1\nline 2\n");
        expect(stderrLogHandlerMock.handle).toHaveBeenCalledWith("line 3");
    });
});
