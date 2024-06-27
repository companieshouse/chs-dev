import { beforeAll, expect, jest } from "@jest/globals";
import fs from "fs";
import { join } from "path";
import LogEverythingLogHandler from "../../src/run/logs/LogEverythingLogHandler";

describe("DockerLogin", () => {

    let DockerEcrLogin;
    let dockerLogin;

    const spawnMock = jest.fn();

    jest.mock("../../src/helpers/spawn-promise", () => {
        return {
            spawn: spawnMock
        };
    });

    const authenticatedRepositories = [
        "123456789.dkr.ecr.eu-west-1.amazonaws.com",
        "123456789.dkr.ecr.eu-west-2.amazonaws.com",
        "223456789.dkr.ecr.eu-west-2.amazonaws.com"
    ];

    const chsDevInstallDir = "/users/user/.chs-dev";

    const loggerMock = {
        log: jest.fn()
    };

    beforeAll(async () => {
        ({ DockerEcrLogin } = await import("../../src/run/docker-ecr-login"));
    });

    describe("attemptToLoginToDockerEcr", () => {
        const existsSyncSpy = jest.spyOn(fs, "existsSync");

        beforeEach(() => {
            jest.resetAllMocks();

            dockerLogin = new DockerEcrLogin(chsDevInstallDir, {
                env: {},
                projectPath: ".",
                authenticatedRepositories
            }, loggerMock);

        });

        it("checks for aws configuration", async () => {
            spawnMock.mockResolvedValue(undefined as never);

            existsSyncSpy.mockReturnValue(true);

            await dockerLogin.attemptLoginToDockerEcr();

            expect(existsSyncSpy).toHaveBeenCalledWith(
                join(process.env.HOME as string, ".aws/config")
            );
        });

        it("rejects with error if no aws configuration", async () => {
            spawnMock.mockResolvedValue(undefined as never);

            existsSyncSpy.mockReturnValue(false);

            await expect(dockerLogin.attemptLoginToDockerEcr()).rejects.toEqual(
                new Error("Does not look like AWS has been configured")
            );
        });

        it("runs login script for requested repos", async () => {
            spawnMock.mockResolvedValue(undefined as never);

            existsSyncSpy.mockReturnValue(true);

            await dockerLogin.attemptLoginToDockerEcr();

            expect(spawnMock).toHaveBeenCalledWith(
                join(chsDevInstallDir, "bin/docker_login.sh"),
                [
                    "--",
                    ...authenticatedRepositories
                ], {
                    logHandler: expect.any(LogEverythingLogHandler),
                    spawnOptions: {
                        shell: "/bin/bash"
                    }
                }
            );
        });
    });

});
