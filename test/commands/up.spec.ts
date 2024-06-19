import { expect, jest } from "@jest/globals";
import { State } from "../../src/state/state-manager";
import Up from "../../src/commands/up";
import { Config } from "@oclif/core";

const startDevelopmentModeMock = jest.fn();
const dockerComposeUpMock = jest.fn();
const dependencyCacheUpdateMock = jest.fn();

const NO_SERVICES_IN_DEV_MODE = {
    modules: [],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [],
    excludedFiles: []
};

const SERVICES_IN_DEV_MODE = {
    modules: [],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [
        "service-one"
    ],
    excludedFiles: []
};

let snapshot: State = NO_SERVICES_IN_DEV_MODE;

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return { snapshot };
        }
    };
});

jest.mock("../../src/run/dependency-cache", () => {
    return {
        DependencyCache: function () {
            return {
                update: dependencyCacheUpdateMock
            };
        }
    };
});

jest.mock("../../src/run/docker-compose", () => {
    return {
        DockerCompose: function () {
            return {
                up: dockerComposeUpMock
            };
        }
    };
});

jest.mock("../../src/run/development-mode", () => {
    return {
        DevelopmentMode: function () {
            return {
                start: startDevelopmentModeMock
            };
        }
    };
});

describe("Up command", () => {
    let up: Up;
    let testConfig: Config;

    let runHookMock;

    beforeEach(() => {
        jest.resetAllMocks();

        const cwdSpy = jest.spyOn(process, "cwd");
        cwdSpy.mockReturnValue("/users/user/docker-chs/");

        runHookMock = jest.fn();

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", runHook: runHookMock };

        up = new Up([], testConfig);

        snapshot = NO_SERVICES_IN_DEV_MODE;
    });

    it("should call up", async () => {
        await up.run();

        expect(dockerComposeUpMock).toHaveBeenCalledTimes(1);
    });

    it("should not call developmentMode start when no services in dev", async () => {
        await up.run();

        expect(startDevelopmentModeMock).not.toHaveBeenCalled();
    });

    it("should not update dependency cache when no services in dev mode", async () => {
        await up.run();

        expect(dependencyCacheUpdateMock).not.toHaveBeenCalled();
    });

    describe("services in development mode", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            snapshot = SERVICES_IN_DEV_MODE;
        });

        it("should call up", async () => {
            await up.run();

            expect(dockerComposeUpMock).toHaveBeenCalledTimes(1);
        });

        it("should call developmentMode start", async () => {
            await up.run();

            expect(startDevelopmentModeMock).toHaveBeenCalled();
        });

        it("should update dependency cache", async () => {
            await up.run();

            expect(dependencyCacheUpdateMock).toHaveBeenCalled();
        });

    });
});
