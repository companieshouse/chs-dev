import { expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";
import Zero from "../../src/commands/zero";
import configLoaderMock from "../../src/helpers/config-loader";
import ChsDevConfig from "../../src/model/Config";
import State from "../../src/model/State";
import { StateManager } from "../../src/state/state-manager";

const clearModulesMock = jest.fn();
const clearServicesMock = jest.fn();
const runHookMock = jest.fn();

jest.mock("../../src/state/state-manager");
jest.mock("../../src/helpers/config-loader");

const chsDevConfig: ChsDevConfig = {
    projectPath: "./docker-chs",
    projectName: "docker-chs",
    env: {},
    versionSpecification: "<=0.1.16"
};

describe("Zero Command", () => {
    let zero: Zero;
    let logMock: jest.SpiedFunction<typeof zero.log>;

    const setUpCommand = (snapshot: State) => {
        // @ts-expect-error
        const testConfig: Config = { root: "./", configDir: "./config", cacheDir: "./cache", runHook: runHookMock };

        // @ts-expect-error
        StateManager.mockReturnValue({ snapshot, clearModules: clearModulesMock, clearServices: clearServicesMock });

        // @ts-expect-error
        configLoaderMock.mockReturnValue(chsDevConfig);

        zero = new Zero([], testConfig);

        logMock = jest.spyOn(zero, "log").mockImplementation(() => {});
    };

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("clears modules and services and regenerates the docker compose file", async () => {
        setUpCommand({
            modules: ["module-one"],
            services: ["service-one", "service-two"],
            servicesWithLiveUpdate: ["service-three"],
            excludedServices: ["service-four"]
        });

        await zero.run();

        expect(clearModulesMock).toHaveBeenCalledTimes(1);
        expect(clearServicesMock).toHaveBeenCalledTimes(1);
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
        expect(clearModulesMock.mock.invocationCallOrder[0]).toBeLessThan(runHookMock.mock.invocationCallOrder[0]);
        expect(clearServicesMock.mock.invocationCallOrder[0]).toBeLessThan(runHookMock.mock.invocationCallOrder[0]);
    });

    it("logs each module and service that has been disabled", async () => {
        setUpCommand({
            modules: ["module-one"],
            services: ["service-one", "service-two"],
            servicesWithLiveUpdate: [],
            excludedServices: []
        });

        await zero.run();

        expect(logMock).toHaveBeenCalledWith("Module \"module-one\" is disabled");
        expect(logMock).toHaveBeenCalledWith("Service \"service-one\" is disabled");
        expect(logMock).toHaveBeenCalledWith("Service \"service-two\" is disabled");
    });

    it("clears state when only modules are enabled", async () => {
        setUpCommand({
            modules: ["module-one"],
            services: [],
            servicesWithLiveUpdate: [],
            excludedServices: []
        });

        await zero.run();

        expect(clearModulesMock).toHaveBeenCalledTimes(1);
        expect(clearServicesMock).toHaveBeenCalledTimes(1);
        expect(runHookMock).toHaveBeenCalledTimes(1);
    });

    it("does nothing when no modules or services are enabled", async () => {
        setUpCommand({
            modules: [],
            services: [],
            servicesWithLiveUpdate: ["service-one"],
            excludedServices: ["service-two"]
        });

        await zero.run();

        expect(clearModulesMock).not.toHaveBeenCalled();
        expect(clearServicesMock).not.toHaveBeenCalled();
        expect(runHookMock).not.toHaveBeenCalled();
        expect(logMock).toHaveBeenCalledWith("No modules or services are enabled - nothing to disable");
    });
});
