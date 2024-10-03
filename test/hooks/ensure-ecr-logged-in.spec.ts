import { expect, jest } from "@jest/globals";
import fs from "fs";
import confirm from "@inquirer/confirm";
import { hook } from "../../src/hooks/ensure-ecr-logged-in";
import { join } from "path";
import { error } from "console";

const attemptLoginToDockerEcrMock = jest.fn();
const configLoaderMock = jest.fn();

jest.mock("../../src/run/docker-ecr-login", () => {
    return {
        DockerEcrLogin: function () {
            return {
                attemptLoginToDockerEcr: attemptLoginToDockerEcrMock
            };
        }
    };
});

jest.mock("../../src/helpers/config-loader", () => {
    return () => {
        return configLoaderMock();
    };
});

jest.mock("@inquirer/confirm");

const testTimeIsoUtc = "2024-05-01T11:00:00.000Z";

const testTimeMinusHours = (hours) => {
    const testTime = Date.parse(testTimeIsoUtc);

    const hoursInMillis = 60 * 60 * 1000 * hours;

    return new Date(testTime - hoursInMillis).toUTCString();
};

describe("prerun hook", () => {
    const readFileSyncSpy = jest.spyOn(fs, "readFileSync");
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    const existsSyncSpy = jest.spyOn(fs, "existsSync");

    const dataDir = "/users/user/Local/config/chs-dev";
    const testConfig = {
        dataDir,
        root: "/users/user/.chs-dev"
    };
    const testContext = {
        error: jest.fn()
    };

    const environmentConfigWithAuthedRepositories = {
        env: {},
        projectPath: "/users/user/docker-chs",
        projectName: "docker-chs",
        performEcrLoginHoursThreshold: 8
    };
    const environmentConfigWithoutAuthedRepositories = {
        env: {},
        projectPath: "/users/user/docker-chs",
        projectName: "docker-chs"
    };

    beforeEach(() => {
        jest.resetAllMocks();

        Date.now = () => Date.parse(testTimeIsoUtc);

        delete process.env.CHS_DEV_FORCE_ECR_CHECK;
    });

    it("always run check when CHS_DEV_FORCE_ECR_CHECK is set", async () => {
        process.env.CHS_DEV_FORCE_ECR_CHECK = "FORCE";

        // @ts-expect-error
        confirm.mockResolvedValue(true);

        existsSyncSpy.mockReturnValue(true);

        readFileSyncSpy.mockReturnValue(
            Buffer.from(testTimeMinusHours(7), "utf8")
        );

        configLoaderMock.mockReturnValue(
            environmentConfigWithAuthedRepositories
        );

        // @ts-expect-error
        await hook({ config: testConfig, context: testContext });

        expect(attemptLoginToDockerEcrMock).toHaveBeenCalled();
    });

    describe("when not run before", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            configLoaderMock.mockReturnValue(
                environmentConfigWithAuthedRepositories
            );

            existsSyncSpy.mockReturnValue(false);

        });

        it("prompts user to confirm whether they want to login when authed repos present", async () => {
            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(confirm).toHaveBeenCalledWith({
                message: "Do you want to attempt to login to AWS ECR?"
            });
        });

        it("attempts login when user confirms", async () => {
            // @ts-expect-error
            confirm.mockResolvedValue(true);

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(attemptLoginToDockerEcrMock).toHaveBeenCalled();
        });

        it("does not attempt to login if user does not confirm", async () => {
            // @ts-expect-error
            confirm.mockResolvedValue(false);
            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(attemptLoginToDockerEcrMock).not.toHaveBeenCalled();
        });

        it("writes last runtime to file", async () => {
            // @ts-expect-error
            confirm.mockResolvedValue(true);

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(writeFileSyncSpy).toHaveBeenCalledWith(
                join(dataDir, "docker-chs.prerun.last_run_time"),
                testTimeIsoUtc
            );
        });

        it("prompts user whether they want to continue if it fails", async () => {
            // @ts-expect-error
            confirm.mockResolvedValue(true);

            attemptLoginToDockerEcrMock.mockRejectedValue(
                new Error("Cannot locate configured AWS profiles") as never
            );

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(confirm).toHaveBeenCalledTimes(2);
            expect(confirm).toHaveBeenCalledWith({
                message: "Was not able to login to ECR do you want to continue?"
            });
        });

        it("errors when user does not want to continue when there was an error logging in", async () => {
            // @ts-expect-error
            confirm.mockResolvedValueOnce(true)
                .mockResolvedValue(false);

            attemptLoginToDockerEcrMock.mockRejectedValue(
                new Error("Cannot locate configured AWS profiles") as never
            );

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(testContext.error).toHaveBeenCalledWith(
                new Error("not logged into AWS ECR")
            );
        });

        it("updates the runtime when user continues after error", async () => {
            // @ts-expect-error
            confirm.mockResolvedValue(true);

            attemptLoginToDockerEcrMock.mockRejectedValue(
               new Error("Cannot locate configured AWS profiles") as never
            );

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(writeFileSyncSpy).toHaveBeenCalled();
        });

        it("does not update runtime when user does not want to continue", async () => {
            // @ts-expect-error
            confirm.mockResolvedValueOnce(true)
                .mockResolvedValue(false);

            attemptLoginToDockerEcrMock.mockRejectedValue(
                new Error("Cannot locate configured AWS profiles") as never
            );

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(writeFileSyncSpy).not.toHaveBeenCalled();
            expect(testContext.error).toHaveBeenCalledWith(
                new Error("not logged into AWS ECR")
            );
        });

        it("checks for presence of the last runtime file", async () => {
            // @ts-expect-error
            confirm.mockResolvedValue(true);

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(existsSyncSpy).toHaveBeenCalledWith(
                join(dataDir, "docker-chs.prerun.last_run_time")
            );

        });
    });

    describe("prerun hook subsequent runs and there are authed repos", () => {

        beforeEach(() => {
            jest.resetAllMocks();

            configLoaderMock.mockReturnValue(
                environmentConfigWithAuthedRepositories
            );

            existsSyncSpy.mockReturnValue(true);

        });

        it("does not do anything when time has not passed threshold", async () => {
            readFileSyncSpy.mockReturnValue(
                Buffer.from(testTimeMinusHours(7), "utf8")
            );

            // @ts-expect-error
            await hook({ config: testConfig, context: testContext });

            expect(confirm).not.toHaveBeenCalled();
            expect(writeFileSyncSpy).not.toHaveBeenCalled();
            expect(attemptLoginToDockerEcrMock).not.toHaveBeenCalled();
        });
    });
});
