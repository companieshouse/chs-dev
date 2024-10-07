import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import childProcess from "child_process";
import fs, { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Config from "../../src/model/Config";

describe("DockerCompose", () => {
    const execSyncMock = jest.spyOn(childProcess, "execSync");
    const spawnMock = jest.fn();
    const existsSyncMock = jest.spyOn(fs, "existsSync");
    const mkdirSyncMock = jest.spyOn(fs, "mkdirSync");
    const readFileSyncMock = jest.spyOn(fs, "readFileSync");

    const mockPatternMatchingHandle = jest.fn();
    const mockWatchLogHandle = jest.fn();
    const mockLogEverythingLogHandle = jest.fn();

    const sshPrivateKey = "ssh-rsa blagr94@testuer";

    const config: Config = {
        env: {
            SSH_PRIVATE_KEY: sshPrivateKey,
            ANOTHER_VALUE: "another-value"
        },
        projectPath: "./",
        projectName: "project"
    };

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

    jest.mock("../../src/run/logs/LogEverythingLogHandler", () => {
        return function () {
            return {
                handle: mockLogEverythingLogHandle
            };
        };
    });

    jest.mock("../../src/helpers/spawn-promise", () => {
        return {
            spawn: spawnMock
        };
    });

    const logger: {
        log: (msg: string) => void
    } = {
        log: jest.fn()
    };

    let tmpDir: string;
    let DockerCompose: new (arg0: Config, arg1: { log: (msg: string) => void; }) => any;

    // 2024-02-14T00:00:00.000Z
    const testDateTime = new Date(2024, 1, 14, 0, 0, 0);

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
            new DockerCompose(config, logger);

            expect(existsSyncMock).toHaveBeenCalledTimes(1);
            expect(existsSyncMock).toHaveBeenCalledWith("local/.logs");
            expect(mkdirSyncMock).not.toHaveBeenCalled();
        });

        it("creates directory when logs directory does not exist", () => {
            existsSyncMock.mockReturnValue(false);

            // eslint-disable-next-line no-new
            new DockerCompose(config, logger);

            expect(existsSyncMock).toHaveBeenCalledTimes(1);
            expect(mkdirSyncMock).toHaveBeenCalledTimes(1);
            expect(mkdirSyncMock).toHaveBeenCalledWith(
                "local/.logs",
                {
                    recursive: true
                }
            );
        });

        it("sets its log file correctly", () => {
            existsSyncMock.mockReturnValue(true);

            const dockerCompose = new DockerCompose(config, logger);

            expect(dockerCompose.logFile).toBe("local/.logs/compose.out.2024-02-14.txt");
        });
    });

    describe("getServiceStatuses", () => {
        let dockerCompose;
        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(config, logger);
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
                { cwd: config.projectPath }
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
            dockerCompose = new DockerCompose(config, logger);

            spawnMock.mockResolvedValue(undefined as never);

            existsSyncMock.mockReturnValue(true);
        });

        it("executes docker compose down without volumes when nothing supplied", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.down();

            const expectedSpawnOptions = {
                logHandler: { handle: mockPatternMatchingHandle },
                spawnOptions: {
                    env: {
                        ...(process.env),
                        SSH_PRIVATE_KEY: sshPrivateKey,
                        ANOTHER_VALUE: "another-value"
                    }
                },
                acceptableExitCodes: [0, 130]
            };

            expect(spawnMock).toHaveBeenCalledWith("docker",
                [
                    "compose",
                    "--project-directory",
                    config.projectPath,
                    "down",
                    "--remove-orphans"
                ], expectedSpawnOptions);
        });

        it("env not set in config then no environment vars set", async () => {
            process.env = {
                ...(Object.entries(process.env).filter(([key, _]) => key !== "CHS_DEV_GITHUB_SSH_PRIVATE_KEY")
                    .reduce((prev, next) => ({
                        ...prev,
                        [next[0]]: next[1]
                    })), {})
            };

            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            const configMinusEnv = {
                projectPath: "./",
                projectName: "project",
                env: {}
            };

            const dockerComposeMinusEnv = new DockerCompose(configMinusEnv, logger);

            await dockerComposeMinusEnv.down();

            const expectedSpawnOptions = {
                logHandler: { handle: mockPatternMatchingHandle },
                acceptableExitCodes: [0, 130],
                spawnOptions: {}
            };

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "--project-directory",
                config.projectPath,
                "down",
                "--remove-orphans"
            ], expectedSpawnOptions);
        });

        it("rejects when code is not 0 or 130", async () => {
            spawnMock.mockRejectedValue(1 as never);

            await expect(dockerCompose.down()).rejects.toBeInstanceOf(Error);
        });

        it("removes volumes when removeVolumes true", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.down({
                removeVolumes: true
            });
            const expectedSpawnOptions = {
                logHandler: { handle: mockPatternMatchingHandle },
                spawnOptions: {
                    env: {
                        ...(process.env),
                        SSH_PRIVATE_KEY: sshPrivateKey,
                        ANOTHER_VALUE: "another-value"
                    }
                },
                acceptableExitCodes: [0, 130]
            };

            expect(spawnMock).toHaveBeenCalledWith("docker",
                [
                    "compose",
                    "--project-directory",
                    config.projectPath,
                    "down",
                    "--remove-orphans",
                    "--volumes"
                ], expectedSpawnOptions);
        });

        it("removes images when removeImages true", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.down({
                removeImages: true
            });
            const expectedSpawnOptions = {
                logHandler: { handle: mockPatternMatchingHandle },
                spawnOptions: {
                    env: {
                        ...(process.env),
                        SSH_PRIVATE_KEY: sshPrivateKey,
                        ANOTHER_VALUE: "another-value"
                    }
                },
                acceptableExitCodes: [0, 130]
            };

            expect(spawnMock).toHaveBeenCalledWith("docker",
                [
                    "compose",
                    "--project-directory",
                    config.projectPath,
                    "down",
                    "--remove-orphans",
                    "--rmi",
                    "local"
                ], expectedSpawnOptions);
        });
    });

    describe("up", () => {
        let dockerCompose;

        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(config, logger);

            spawnMock.mockResolvedValue(undefined as never);

            existsSyncMock.mockReturnValue(true);
        });

        it("executes docker compose down", async () => {
            await dockerCompose.up();

            const expectedSpawnOptions = {
                logHandler: { handle: mockPatternMatchingHandle },
                spawnOptions: {
                    env: {
                        ...(process.env),
                        SSH_PRIVATE_KEY: sshPrivateKey,
                        ANOTHER_VALUE: "another-value"
                    }
                },
                acceptableExitCodes: [0, 130]
            };

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "--project-directory",
                config.projectPath,
                "up",
                "-d",
                "--remove-orphans"
            ], expectedSpawnOptions);
        });

        it("rejects when code is not 0 or 130", async () => {
            spawnMock.mockRejectedValue(1 as never);

            await expect(dockerCompose.up()).rejects.toBeInstanceOf(Error);
        });
    });

    describe("watch", () => {

        let dockerCompose;
        const mockStdout = jest.fn();

        const mockSterr = jest.fn();
        const mockOnce = jest.fn();

        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(config, logger);

            spawnMock.mockResolvedValue(undefined as never);

        });

        it("runs docker compose watch", async () => {

            await dockerCompose.watch();

            const expectedSpawnOptions = {
                logHandler: { handle: mockWatchLogHandle },
                spawnOptions: {
                    env: {
                        ...(process.env),
                        SSH_PRIVATE_KEY: sshPrivateKey,
                        ANOTHER_VALUE: "another-value"
                    }
                },
                acceptableExitCodes: [0, 130]
            };

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "--project-directory",
                config.projectPath,
                "watch"
            ], expectedSpawnOptions);
        });

        it("rejects when code is not 0 or 130", async () => {
            spawnMock.mockRejectedValue(1 as never);

            await expect(dockerCompose.watch()).rejects.toBeInstanceOf(Error);
        });
    });

    describe("logs", () => {

        let dockerCompose;
        const mockStdout = jest.fn();

        const mockSterr = jest.fn();
        const mockOnce = jest.fn();

        beforeEach(() => {
            jest.resetAllMocks();
            dockerCompose = new DockerCompose(config, logger);

            spawnMock.mockResolvedValue(undefined as never);

        });

        it("runs docker compose logs without service when not supplied", async () => {
            await dockerCompose.logs({});

            const expectedSpawnOptions = {
                logHandler: { handle: mockLogEverythingLogHandle },
                spawnOptions: {
                    env: {
                        ...(process.env),
                        SSH_PRIVATE_KEY: sshPrivateKey,
                        ANOTHER_VALUE: "another-value"
                    }
                },
                acceptableExitCodes: [0, 130]
            };

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "--project-directory",
                config.projectPath,
                "logs"
            ], expectedSpawnOptions);
        });

        it("runs docker compose logs with services when supplied", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.logs({ serviceNames: ["service-one", "service-two"] });

            const expectedSpawnOptions = {
                logHandler: { handle: mockLogEverythingLogHandle },
                spawnOptions: {
                    env: {
                        ...(process.env),
                        SSH_PRIVATE_KEY: sshPrivateKey,
                        ANOTHER_VALUE: "another-value"
                    }
                },
                acceptableExitCodes: [0, 130]
            };

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "--project-directory",
                config.projectPath,
                "logs",
                "--",
                "service-one",
                "service-two"
            ], expectedSpawnOptions);
        });
        it("rejects when code is not 0 or 130", async () => {
            spawnMock.mockRejectedValue(1 as never);

            await expect(dockerCompose.logs({})).rejects.toBeInstanceOf(Error);
        });

        it("tails for specified limit", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.logs({ serviceNames: ["service-one"], tail: "10" });

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "--project-directory",
                config.projectPath,
                "logs",
                "--tail",
                "10",
                "--",
                "service-one"
            ], expect.anything());
        });

        it("follows", async () => {
            mockOnce.mockImplementation((type, listener) => {
                if (type === "exit") {
                    // @ts-expect-error
                    listener(0);
                }
            });

            await dockerCompose.logs({ serviceNames: ["service-one"], follow: true });

            expect(spawnMock).toHaveBeenCalledWith("docker", [
                "compose",
                "--project-directory",
                config.projectPath,
                "logs",
                "--follow",
                "--",
                "service-one"
            ], expect.anything());
        });
    });
});
