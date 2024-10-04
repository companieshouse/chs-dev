import { expect, jest } from "@jest/globals";
import Up from "../../src/commands/up";
import { Config } from "@oclif/core";
import { State } from "../../src/model/State";
import { services, modules } from "../utils/data";
import { StateManager } from "../../src/state/state-manager";
import { Inventory } from "../../src/state/inventory";
import { DependencyCache } from "../../src/run/dependency-cache";
import { DockerCompose } from "../../src/run/docker-compose";
import { DevelopmentMode } from "../../src/run/development-mode";
import { ComposeLogViewer } from "../../src/run/compose-log-viewer";
import { PermanentRepositories } from "../../src/state/permanent-repositories";

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

const UNRELATED_SERVICE_IN_DEV_MODE = {
    modules: [
    ],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [
        "service-two"
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

const dockerComposeMock = {
    up: jest.fn()
};

const developmentModeMock = {
    start: jest.fn()
};

jest.mock("../../src/state/state-manager");

jest.mock("../../src/state/inventory");

jest.mock("../../src/run/dependency-cache");

jest.mock("../../src/run/docker-compose");

jest.mock("../../src/run/development-mode");

jest.mock("../../src/run/compose-log-viewer");

jest.mock("../../src/state/permanent-repositories");

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

        //  @ts-expect-error
        Inventory.mockReturnValue({ services, modules });

        // @ts-expect-error
        StateManager.mockReturnValue({ snapshot });

        // @ts-expect-error
        DependencyCache.mockReturnValue({
            update: dependencyCacheUpdateMock
        });

        // @ts-expect-error
        DockerCompose.mockReturnValue(dockerComposeMock);

        // @ts-expect-error
        DevelopmentMode.mockReturnValue(developmentModeMock);

        // @ts-expect-error
        ComposeLogViewer.mockReturnValue({
            view: composeLogViewerViewMock
        });

        // @ts-expect-error
        PermanentRepositories.mockReturnValue({
            ensureAllExistAndAreUpToDate: permanentRepositoriesEnsureAllExistAndAreUpToDateMock
        });

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

        expect(dockerComposeMock.up).toHaveBeenCalledTimes(1);
    });

    it("should not call developmentMode start when no services in dev", async () => {
        await up.run();

        expect(developmentModeMock.start).not.toHaveBeenCalled();
    });

    it("should not update dependency cache when no services in dev mode", async () => {
        await up.run();

        expect(dependencyCacheUpdateMock).not.toHaveBeenCalled();
    });

    it("should display a couple of lines of output if it fails", async () => {
        dockerComposeMock.up.mockRejectedValue(new Error("error") as never);

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

            expect(dockerComposeMock.up).toHaveBeenCalledTimes(1);
        });

        it("should handle service being in module", async () => {
            setUpCommand(MODULE_WITH_SERVICE_IN_DEV_MODE);

            await up.run();

            expect(developmentModeMock.start).toHaveBeenCalledTimes(1);
        });

        it("should call developmentMode start", async () => {
            await up.run();

            expect(developmentModeMock.start).toHaveBeenCalled();
        });

        it("should update dependency cache", async () => {
            await up.run();

            expect(dependencyCacheUpdateMock).toHaveBeenCalled();
        });

        it("should display a couple of lines of output if it fails", async () => {
            dockerComposeMock.up.mockRejectedValue(new Error("error") as never);

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

    describe("services in live update are not enabled", () => {

        beforeEach(() => {
            jest.resetAllMocks();

            setUpCommand(UNRELATED_SERVICE_IN_DEV_MODE);
        });

        it("should not run development mode", async () => {
            await up.run();

            expect(developmentModeMock.start).not.toHaveBeenCalled();

            expect(dependencyCacheUpdateMock).not.toHaveBeenCalled();
        });

    });

    it("should run the ensure ecr is logged in hook", async () => {
        await up.run();

        expect(runHookMock).toHaveBeenCalledWith("ensure-ecr-logged-in", {});
    });

    it("should not run up if ecr was not logged in successfully", async () => {
        runHookMock.mockRejectedValue(new Error("error"));

        await expect(up.run()).rejects.toEqual(expect.anything());

        expect(dockerComposeMock.up).not.toHaveBeenCalled();
    });

    it("should not run generate-development-docker-compose hook", async () => {
        await up.run();

        expect(runHookMock).not.toHaveBeenCalledWith(
            "generate-development-docker-compose",
            expect.anything()
        );
    });
});
