import { DockerCompose } from "../../src/run/docker-compose";
import { beforeAll, expect, jest } from "@jest/globals";

const action = {
    stop: jest.fn(),
    start: jest.fn()
};

describe("DevelopmentMode", () => {

    jest.mock("@oclif/core", () => {
        return { ux: { action } };
    });

    let DevelopmentMode;

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

    beforeAll(async () => {
        ({ DevelopmentMode } = await import("../../src/run/development-mode"));
    });
    beforeEach(async () => {
        jest.resetAllMocks();

        developmentMode = new DevelopmentMode(dockerComposeMock);

        // @ts-expect-error
        dockerComposeMock.down.mockResolvedValue(undefined as never);
    });

    describe("sigintHandle", () => {

        beforeEach(() => {
            jest.resetAllMocks();
            // @ts-expect-error
            dockerComposeMock.down.mockResolvedValue(undefined as never);
        });

        it("does not stop environment when prompt is no", async () => {
            // @ts-expect-error
            prompterMock.mockResolvedValue(false);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(dockerComposeMock.down).not.toHaveBeenCalled();
        });

        it("stops environment when prompt is yes", async () => {
            // @ts-expect-error
            prompterMock.mockResolvedValue(true);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(dockerComposeMock.down).toHaveBeenCalledWith({
                removeVolumes: false,
                removeImages: false
            });
        });

        it("notifies controller it should stop", async () => {
            // @ts-expect-error
            prompterMock.mockResolvedValue(true);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(controllerMock.abort).toHaveBeenCalledTimes(1);
        });

        it("restarts spinner", async () => {
            // @ts-expect-error
            prompterMock.mockResolvedValue(true);

            await developmentMode.sigintHandler(controllerMock, prompterMock);

            expect(action.stop).toHaveBeenCalled();
            expect(action.start).toHaveBeenCalled();
        });

    });
});
