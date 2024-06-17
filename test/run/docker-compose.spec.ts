import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import childProcess from "child_process";
// @ts-expect-error it does have rmSync
import fs, { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("DockerCompose", () => {
    const execSyncMock = jest.spyOn(childProcess, "execSync");
    const spawnMock = jest.spyOn(childProcess, "spawn");
    const existsSyncMock = jest.spyOn(fs, "existsSync");
    const mkdirSyncMock = jest.spyOn(fs, "mkdirSync");
    const readFileSyncMock = jest.spyOn(fs, "readFileSync");

    const mockPatternMatchingHandle = jest.fn();
    const mockWatchLogHandle = jest.fn();

    const sshPrivateKey = "ssh-rsa blagr94@testuer";
    const sshPrivateKeyFile = "~/.ssh/id_rsa";

    jest.mock("../../src/run/logs/PatternMatchingConsoleLogHandler", () => {
        return function () {
            return {
                handle: mockPatternMatchingHandle
            };
        };
    });

    jest.mock("../../src/run/logs/DockerComposeWatchLogHandler", () => {
        return function () {
            return {
                handle: mockWatchLogHandle
            };
        };
    });

    const logger: {
        log: (msg: string) => void
    } = {
        log: jest.fn()
    };

    let tmpDir: string;
    let DockerCompose: new (arg0: string, arg1: { log: (msg: string) => void; }) => any;

    const testDateTime = new Date(2024, 1, 1, 0, 0, 0);

    beforeAll(async () => {

        tmpDir = mkdtempSync(join(tmpdir(), "docker-compose"));
        // @ts-expect-error This is creating a spied version and is valid
        Date.now = () => testDateTime;
    });

    beforeEach(async () => {
        ({ DockerCompose } = await import("../../src/run/docker-compose"));

    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("constructor", () => {
        beforeEach(() => {
            jest.resetAllMocks();
        });

        it("Does not create directory when logs directory exists", () => {
            existsSyncMock.mockReturnValue(true);

            // eslint-disable-next-line no-new
            new DockerCompose(tmpDir, logger);

            expect(existsSyncMock).toHaveBeenCalledTimes(1);
            expect(existsSyncMock).toHaveBeenCalledWith(join(tmpDir, "local/.logs"));
            expect(mkdirSyncMock).not.toHaveBeenCalled();
        });

        it("creates directory when logs directory does not exist", () => {
            existsSyncMock.mockReturnValue(false);

            // eslint-disable-next-line no-new
            new DockerCompose(tmpDir, logger);

            expect(existsSyncMock).toHaveBeenCalledTimes(1);
            expect(mkdirSyncMock).toHaveBeenCalledTimes(1);
            expect(mkdirSyncMock).toHaveBeenCalledWith(
                join(tmpDir, "local/.logs"),
                {
                    recursive: true
                }
            );
        });

        it("sets its log file correctly", () => {
            existsSyncMock.mockReturnValue(true);

            const dockerCompose = new DockerCompose(tmpDir, logger);

            expect(dockerCompose.logFile).toBe(join(tmpDir, "local/.logs/compose.out.1706745600.txt"));
        });
    });

    describe("getServiceStatuses", () => {
        let dockerCompose;
        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(tmpDir, logger);
        });

        it("returns undefined when docker-compose.yaml file does not exist", () => {
            existsSyncMock.mockReturnValue(false);

            const result = dockerCompose.getServiceStatuses();

            expect(result).toBeUndefined();
        });

        it("does not call execSync when no docker-compose.yaml file", () => {
            existsSyncMock.mockReturnValue(false);

            dockerCompose.getServiceStatuses();

            expect(execSyncMock).not.toHaveBeenCalled();
        });

        it("calls docker compose when docker-compose.yaml file exists", () => {
            existsSyncMock.mockReturnValue(true);
            execSyncMock.mockReturnValue(Buffer.from("", "utf8"));

            dockerCompose.getServiceStatuses();

            expect(execSyncMock).toHaveBeenCalledWith(
                "docker compose ps -a --format '{{.Service}},{{.Status}}' 2>/dev/null || : \"\"",
                { cwd: dockerCompose.path }
            );
        });

        it("returns undefined when docker compose errored", () => {
            existsSyncMock.mockReturnValue(true);
            execSyncMock.mockReturnValue(Buffer.from("", "utf8"));

            const result = dockerCompose.getServiceStatuses();

            expect(result).toBeUndefined();
        });

        it("returns service statuses as object", () => {
            const expected = {
                serviceOne: "up",
                serviceTwo: "down",
                serviceThree: "healthy"
            };

            existsSyncMock.mockReturnValue(true);
            execSyncMock.mockReturnValue(Buffer.from(Object.entries(expected).map(([name, value]) => `${name},${value}`).join("\n"), "utf8"));

            const result = dockerCompose.getServiceStatuses();

            expect(result).toEqual(expected);
        });
    });

    describe("down", () => {
        let dockerCompose;
        const mockStdout = jest.fn();

        const mockSterr = jest.fn();
        const mockOnce = jest.fn();

        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(tmpDir, logger);

            spawnMock.mockReturnValue({
                // @ts-expect-error
                stdout: { on: mockStdout },
                // @ts-expect-error
                stderr: { on: mockSterr },
                // @ts-expect-error
                once: mockOnce
            });

            process.env = {
                ...(process.env),
                CHS_DEV_GITHUB_SSH_PRIVATE_KEY: sshPrivateKeyFile
            };

            readFileSyncMock.mockReturnValue(
                Buffer.from(sshPrivateKey, "utf8")
            );
        });

        it("executes docker compose down", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.down();

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "down",
                "--remove-orphans"
            ], {
                cwd: dockerCompose.path,
                env: {
                    ...(process.env),
                    SSH_PRIVATE_KEY: sshPrivateKey
                }
            });
        });

        it("errors when CHS_DEV_GITHUB_SSH_PRIVATE_KEY not set", async () => {
            process.env = {
                ...(Object.entries(process.env).filter(([key, _]) => key !== "CHS_DEV_GITHUB_SSH_PRIVATE_KEY")
                    .reduce((prev, next) => ({
                        ...prev,
                        [next[0]]: next[1]
                    })), {})
            };

            await expect(dockerCompose.down()).rejects.toBeInstanceOf(Error);

            expect(readFileSyncMock).not.toHaveBeenCalled();
        });

        it("resolves when code is 130", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(130);
                }
            });

            await expect(dockerCompose.down()).resolves.toBeUndefined();
        });

        it("rejects when code is not 0 or 130", async () => {

            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(1);
                }
            });

            await expect(dockerCompose.down()).rejects.toBeInstanceOf(Error);
        });

        it("attaches pattern listener to stdout and stderr", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            mockStdout.mockImplementation((event, listener) => {
                if (event === "data") {
                    // @ts-expect-error
                    listener("stdout data");
                }
            });

            mockSterr.mockImplementation((event, listener) => {
                if (event === "data") {
                    // @ts-expect-error
                    listener("stderr data");
                }
            });

            await dockerCompose.down();

            expect(mockPatternMatchingHandle).toHaveBeenCalledWith("stdout data");
            expect(mockPatternMatchingHandle).toHaveBeenCalledWith("stderr data");
        });
    });

    describe("up", () => {
        let dockerCompose;
        const mockStdout = jest.fn();

        const mockSterr = jest.fn();
        const mockOnce = jest.fn();

        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(tmpDir, logger);

            spawnMock.mockReturnValue({
                // @ts-expect-error
                stdout: { on: mockStdout },
                // @ts-expect-error
                stderr: { on: mockSterr },
                // @ts-expect-error
                once: mockOnce
            });

            process.env = {
                ...(process.env),
                CHS_DEV_GITHUB_SSH_PRIVATE_KEY: sshPrivateKeyFile
            };

            readFileSyncMock.mockReturnValue(
                Buffer.from(sshPrivateKey, "utf8")
            );
        });

        it("executes docker compose down", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.up();

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "up",
                "-d",
                "--remove-orphans"
            ], {
                cwd: dockerCompose.path,
                env: {
                    ...(process.env),
                    SSH_PRIVATE_KEY: sshPrivateKey
                },
                signal: undefined
            });
        });

        it("resolves when code is 130", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(130);
                }
            });

            await expect(dockerCompose.up()).resolves.toBeUndefined();
        });

        it("rejects when code is not 0 or 130", async () => {

            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(1);
                }
            });

            await expect(dockerCompose.up()).rejects.toBeInstanceOf(Error);
        });

        it("attaches pattern listener to stdout and stderr", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            mockStdout.mockImplementation((event, listener) => {
                if (event === "data") {
                    // @ts-expect-error
                    listener("stdout data");
                }
            });

            mockSterr.mockImplementation((event, listener) => {
                if (event === "data") {
                    // @ts-expect-error
                    listener("stderr data");
                }
            });

            await dockerCompose.up();

            expect(mockPatternMatchingHandle).toHaveBeenCalledWith("stdout data");
            expect(mockPatternMatchingHandle).toHaveBeenCalledWith("stderr data");
        });
    });

    describe("watch", () => {

        let dockerCompose;
        const mockStdout = jest.fn();

        const mockSterr = jest.fn();
        const mockOnce = jest.fn();

        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(tmpDir, logger);

            spawnMock.mockReturnValue({
                // @ts-expect-error
                stdout: { on: mockStdout },
                // @ts-expect-error
                stderr: { on: mockSterr },
                // @ts-expect-error
                once: mockOnce
            });

            process.env = {
                ...(process.env),
                CHS_DEV_GITHUB_SSH_PRIVATE_KEY: sshPrivateKeyFile
            };

            readFileSyncMock.mockReturnValue(
                Buffer.from(sshPrivateKey, "utf8")
            );
        });

        it("runs docker compose watch", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.watch();

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "watch"
            ], {
                cwd: dockerCompose.path,
                env: {
                    ...(process.env),
                    SSH_PRIVATE_KEY: sshPrivateKey
                }
            });
        });

        it("resolves when code is 130", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(130);
                }
            });

            await expect(dockerCompose.watch()).resolves.toBeUndefined();
        });

        it("rejects when code is not 0 or 130", async () => {

            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(1);
                }
            });

            await expect(dockerCompose.watch()).rejects.toBeInstanceOf(Error);
        });

        it("attaches pattern listener to stdout and stderr", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            mockStdout.mockImplementation((event, listener) => {
                if (event === "data") {
                    // @ts-expect-error
                    listener("stdout data");
                }
            });

            mockSterr.mockImplementation((event, listener) => {
                if (event === "data") {
                    // @ts-expect-error
                    listener("stderr data");
                }
            });

            await dockerCompose.watch();

            expect(mockWatchLogHandle).toHaveBeenCalledWith("stdout data");
            expect(mockWatchLogHandle).toHaveBeenCalledWith("stderr data");
        });
    });
});
