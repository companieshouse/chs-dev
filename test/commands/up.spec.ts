import { expect, jest } from "@jest/globals";
import Up from "../../src/commands/up";
import { Config } from "@oclif/core";
import { State } from "../../src/model/State";
import { services, modules } from "../utils/data";

const startDevelopmentModeMock = jest.fn();
const dockerComposeUpMock = jest.fn();
const dependencyCacheUpdateMock = jest.fn();
const composeLogViewerViewMock = jest.fn();
const permanentRepositoriesEnsureAllExistAndAreUpToDateMock = jest.fn();

const NO_SERVICES_IN_DEV_MODE = {
    modules: [],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [],
    excludedServices: []
};

const SERVICES_IN_DEV_MODE = {
    modules: [],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [
        "service-one"
    ],
    excludedServices: []
};

const MODULE_WITH_SERVICE_IN_DEV_MODE = {
    modules: [
        "module-five"
    ],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [
        "service-twelve"
    ],
    excludedServices: []
};

const stateManagerMock = jest.fn();

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return stateManagerMock();
        }
    };
});

jest.mock("../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return { services, modules };
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

jest.mock("../../src/run/compose-log-viewer", () => {
    return {
        ComposeLogViewer: function () {
            return {
                view: composeLogViewerViewMock
            };
        }
    };
});

jest.mock("../../src/state/permanent-repositories", () => {
    return {
        PermanentRepositories: function () {
            return {
                ensureAllExistAndAreUpToDate: permanentRepositoriesEnsureAllExistAndAreUpToDateMock
            };
        }
    };
});

describe("Up command", () => {
    let up: Up;
    let testConfig: Config;

    let runHookMock;

    const setUpCommand = (snapshot: State) => {
        const cwdSpy = jest.spyOn(process, "cwd");
        cwdSpy.mockReturnValue("/users/user/docker-chs/");

        runHookMock = jest.fn();

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", runHook: runHookMock };

        stateManagerMock.mockReturnValue({ snapshot });

        up = new Up([], testConfig);
    };

    beforeEach(() => {
        jest.resetAllMocks();

        setUpCommand(NO_SERVICES_IN_DEV_MODE);
    });

    it("runs validate-project-state hook with docker-compose.yaml required", async () => {
        await up.run();

        expect(runHookMock).toHaveBeenCalledWith(
            "validate-project-state", {
                requiredFiles: [
                    "docker-compose.yaml"
                ],
                suggestionsOnFailure: [
                    "Try rerunning the command from a valid project with docker-compose.yaml",
                    "Try enabling a service you already have enabled to force recreation of docker-compose.yaml file"
                ]
            }
        );
    });

    it("should ensure all permanent repos are present", async () => {
        await up.run();

        expect(permanentRepositoriesEnsureAllExistAndAreUpToDateMock).toHaveBeenCalled();
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

    it("should display a couple of lines of output if it fails", async () => {
        dockerComposeUpMock.mockRejectedValue(new Error("error") as never);

        await expect(up.run()).rejects.toEqual(expect.any(Error));

        expect(composeLogViewerViewMock).toHaveBeenCalledWith({
            tail: "5",
            follow: false
        });
    });

    describe("services in development mode", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            setUpCommand(SERVICES_IN_DEV_MODE);
        });

        it("should call up", async () => {
            await up.run();

            expect(dockerComposeUpMock).toHaveBeenCalledTimes(1);
        });

        it("should handle service being in module", async () => {
            setUpCommand(MODULE_WITH_SERVICE_IN_DEV_MODE);

            await up.run();

            expect(startDevelopmentModeMock).toHaveBeenCalledTimes(1);
        });

        it("should call developmentMode start", async () => {
            await up.run();

            expect(startDevelopmentModeMock).toHaveBeenCalled();
        });

        it("should update dependency cache", async () => {
            await up.run();

            expect(dependencyCacheUpdateMock).toHaveBeenCalled();
        });

        it("should display a couple of lines of output if it fails", async () => {
            startDevelopmentModeMock.mockRejectedValue(new Error("error") as never);

            await expect(up.run()).rejects.toEqual(expect.any(Error));

            expect(composeLogViewerViewMock).toHaveBeenCalledWith({
                tail: "5",
                follow: false
            });
        });

        it("should synchronise local docker compose specs for services in development mode", async () => {
            await up.run();

            expect(runHookMock).toHaveBeenCalledWith(
                "generate-development-docker-compose", {
                    serviceName: SERVICES_IN_DEV_MODE.servicesWithLiveUpdate[0]
                }
            );
        });

    });

    it("should run the ensure ecr is logged in hook", async () => {
        await up.run();

        expect(runHookMock).toHaveBeenCalledWith("ensure-ecr-logged-in", {});
    });

    it("should not run up if ecr was not logged in successfully", async () => {
        runHookMock.mockRejectedValue(new Error("error"));

        await expect(up.run()).rejects.toEqual(expect.anything());

        expect(dockerComposeUpMock).not.toHaveBeenCalled();
    });

    it("should not run generate-development-docker-compose hook", async () => {
        await up.run();

        expect(runHookMock).not.toHaveBeenCalledWith(
            "generate-development-docker-compose",
            expect.anything()
        );
    });
});
