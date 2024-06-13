import { DockerCompose } from "../../src/run/docker-compose";
import { expect, jest } from "@jest/globals";
import fs from "fs";
import { DevelopmentMode } from "../../src/run/development-mode";

describe("DevelopmentMode", () => {

    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    const existsSyncMock = jest.spyOn(fs, "existsSync");
    const unlinkSyncMock = jest.spyOn(fs, "unlinkSync");

    const dockerComposeMock: DockerCompose = {
        // @ts-expect-error
        up: jest.fn(),
        // @ts-expect-error
        down: jest.fn(),
        // @ts-expect-error
        watch: jest.fn()
    };

    const controllerMock = {
        abort: jest.fn()
    };

    const prompterMock = jest.fn();

    let developmentMode;

    beforeEach(async () => {
        jest.resetAllMocks();

        developmentMode = new DevelopmentMode(dockerComposeMock, "/home/user/project");
    });

    it("rejects when lock already exists", async () => {
        existsSyncMock.mockReturnValue(true);

        try {
            await developmentMode.start(prompterMock);
            // @ts-expect-error
            // eslint-disable-next-line no-undef
            fail("Should have raised error");
        } catch (error) {
            expect(error).toEqual(new Error(
                "ERROR! There are services running in development mode. Stop other development mode processes and try again."
            ));
        }
    });

    describe("sigintHandle", () => {

        beforeEach(() => {
            jest.resetAllMocks();
        });

        it("does not stop environment when prompt is no", async () => {

            unlinkSyncMock.mockImplementation((_) => {});
            // @ts-expect-error
            prompterMock.mockResolvedValue(false);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(dockerComposeMock.down).not.toHaveBeenCalled();
        });

        it("stops environment when prompt is yes", async () => {
            unlinkSyncMock.mockImplementation((_) => {});
            // @ts-expect-error
            prompterMock.mockResolvedValue(true);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(dockerComposeMock.down).toHaveBeenCalled();
        });

        it("releases lock", async () => {
            unlinkSyncMock.mockImplementation((_) => {});
            // @ts-expect-error
            prompterMock.mockResolvedValue(true);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(unlinkSyncMock).toHaveBeenCalledTimes(1);
        });

        it("notifies controller it should stop", async () => {

            unlinkSyncMock.mockImplementation((_) => {});
            // @ts-expect-error
            prompterMock.mockResolvedValue(true);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(controllerMock.abort).toHaveBeenCalledTimes(1);
        });

    });

    it("releases lock if there's an error running watch", async () => {
        // @ts-expect-error
        dockerComposeMock.watch.mockRejectedValue(new Error("Kaboom!"));
        unlinkSyncMock.mockImplementation((_) => {});

        existsSyncMock.mockReturnValue(false);

        try {
            await developmentMode.start(prompterMock);
            // @ts-expect-error
            // eslint-disable-next-line no-undef
            fail("Should have raised error");
        } catch (error) {
            expect(unlinkSyncMock).toHaveBeenCalledTimes(1);
        }
    });

});
