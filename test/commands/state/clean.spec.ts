import { expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";
import Clean from "../../../src/commands/state/clean";
import configLoaderMock from "../../../src/helpers/config-loader";
import { confirm as confirmMock } from "../../../src/helpers/user-input";
import ChsDevConfig from "../../../src/model/Config";
import State from "../../../src/model/State";
import { DockerCompose } from "../../../src/run/docker-compose";
import { StateManager } from "../../../src/state/state-manager";
import { Prune } from "../../../src/model";

const dockerComposeMock = {
    getServiceStatuses: jest.fn(),
    prune: jest.fn()
};
const cleanStateMock = jest.fn();
const runHookMock = jest.fn();

jest.mock("../../../src/state/state-manager");
jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/run/docker-compose");
jest.mock("../../../src/helpers/user-input");

const chsDevConfig: ChsDevConfig = {
    projectPath: "./docker-chs",
    projectName: "docker-chs",
    env: {},
    versionSpecification: "<=0.1.16"
};

const stateSnapshot = {
    modules: [],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [],
    excludedServices: []
};

describe("Clean Command", () => {
    let clean: Clean;
    let testConfig: Config;

    let parseMock: any;

    const setUpCommand = (snapshot: State) => {

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", runHook: runHookMock };

        // @ts-expect-error
        StateManager.mockReturnValue({ snapshot, cleanState: cleanStateMock });

        // @ts-expect-error
        configLoaderMock.mockReturnValue(chsDevConfig);

        // @ts-expect-error
        DockerCompose.mockReturnValue(dockerComposeMock);

        clean = new Clean([], testConfig);

        // @ts-expect-error
        parseMock = jest.spyOn(clean, "parse");

        parseMock.mockResolvedValue({
            flags: {
                purge: false
            }
        });

        (confirmMock as jest.Mock).mockReturnValue(true);
    };

    beforeEach(() => {
        jest.resetAllMocks();

        setUpCommand(stateSnapshot);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("does nothing if user declines confirm prompt", async () => {
        parseMock.mockResolvedValue({ flags: { purge: false } });
        (confirmMock as jest.Mock).mockReturnValue(false);

        await clean.run();

        expect(cleanStateMock).not.toHaveBeenCalled();
        expect(dockerComposeMock.prune).not.toHaveBeenCalled();
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("throws error if containers are running", async () => {
        parseMock.mockResolvedValue({ flags: { purge: false } });

        dockerComposeMock.getServiceStatuses.mockReturnValue({ some: "status" });

        const errorSpy = jest.spyOn(clean, "error").mockImplementation(() => { throw new Error("Containers running"); });

        await expect(clean.run()).rejects.toThrow("Containers running");

        expect(cleanStateMock).not.toHaveBeenCalled();
        expect(dockerComposeMock.prune).not.toHaveBeenCalled();
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("cleans state, runs hook, prunes volumes if containers are stopped", async () => {
        parseMock.mockResolvedValue({ flags: { purge: false } });

        dockerComposeMock.getServiceStatuses.mockReturnValue(undefined);

        await clean.run();

        expect(cleanStateMock).toHaveBeenCalled();
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", { });
        expect(dockerComposeMock.prune).toHaveBeenCalledWith(Prune.VOLUME);
        expect(dockerComposeMock.prune).toHaveBeenCalledTimes(1);
    });

    it("prunes images if --purge flag is set", async () => {
        parseMock.mockResolvedValue({ flags: { purge: true } });

        dockerComposeMock.getServiceStatuses.mockReturnValue(undefined);

        await clean.run();

        expect(dockerComposeMock.prune).toHaveBeenCalledWith(Prune.VOLUME);
        expect(dockerComposeMock.prune).toHaveBeenCalledWith(Prune.IMAGE);
        expect(dockerComposeMock.prune).toHaveBeenCalledTimes(2);
    });

    it("shows correct confirm prompt message for purge", async () => {
        parseMock.mockResolvedValue({ flags: { purge: true } });
        dockerComposeMock.getServiceStatuses.mockReturnValue(undefined);

        await clean.run();

        expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("including images"));
    });

    it("shows correct confirm prompt message for non-purge action", async () => {
        parseMock.mockResolvedValue({ flags: { purge: false } });

        dockerComposeMock.getServiceStatuses.mockReturnValue(undefined);

        await clean.run();

        expect(confirmMock).toHaveBeenCalledWith(expect.not.stringContaining("including images"));
    });
});
