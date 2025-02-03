import { expect, jest } from "@jest/globals";
import { services, modules } from "../utils/data";
import { StateManager } from "../../src/state/state-manager";
import { Inventory } from "../../src/state/inventory";
import checkServiceModuleStateHook from "../../src/hooks/check-service-or-module-state";
import { Config } from "@oclif/core";
import configLoaderMock from "../../src/helpers/config-loader";
import ChsDevConfig from "../../src/model/Config";
import { input } from "../../src/helpers/user-input";
import { findUniqueItems, matchExistInArrays } from "../../src/helpers";

const stateManagerMock = {
    snapshot: {
        modules: [
            "module-one"
        ],
        services: [
            "service-six"
        ],
        servicesWithLiveUpdate: [
            "service-four",
            "service-three",
            "service-two",
            "service-eight"
        ],
        excludedServices: [
            "service-two",
            "service-four",
            "service-nine"
        ]
    }
};

const inventoryMock = {
    services,
    modules
};

const testConfig: ChsDevConfig = {
    projectName: "chs-dev-proj",
    projectPath: "/home/test-user/projects/chs-dev-proj",
    env: {}
};

jest.mock("../../src/state/state-manager");
jest.mock("../../src/state/inventory");
jest.mock("../../src/helpers/config-loader");
jest.mock("../../src/helpers/user-input");
// jest.mock("../../src/helpers/index");

describe("check-service-or-module-state", () => {
    let context;

    beforeEach(() => {
        context = {
            runHook: jest.fn(),
            runCommand: jest.fn(),
            warn: jest.fn(),
            log: jest.fn()
        };

        // @ts-expect-error
        StateManager.mockReturnValue(stateManagerMock);

        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        // @ts-expect-error
        configLoaderMock.mockReturnValue(testConfig);

        (input as jest.Mock).mockImplementation(() => "no");
        // (matchExistInArrays as jest.Mock).mockReturnValue(false);
        // (findUniqueItems as jest.Mock).mockReturnValue([]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should warn when activating a service but services in development mode or exclusions are not activated activated", async () => {
        const mockState = {
            snapshot: {
                servicesWithLiveUpdate: ["serviceA"],
                excludedServices: []
            },
            excludeServiceFromLiveUpdate: jest.fn()
        };

        (StateManager as jest.Mock).mockImplementation(() => mockState);

        // @ts-expect-error
        await checkServiceModuleStateHook({
            activatedServices: ["service-three"],
            topic: "services",
            command: "enable",
            commandArgv: [],
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "The following LiveUpdate services are currently not activated: \"serviceA\". Remove all LiveUpdate services to prevent chs-dev state disarray."
        );
    });

    it("should warn when activating a module but services in development mode or exclusions are not activated activated", async () => {
        const mockState = {
            snapshot: {
                servicesWithLiveUpdate: [],
                excludedServices: ["serviceA"]
            },
            excludeServiceFromLiveUpdate: jest.fn()
        };

        (StateManager as jest.Mock).mockImplementation(() => mockState);

        // @ts-expect-error
        await checkServiceModuleStateHook({
            activatedServices: ["service-three"],
            topic: "services",
            command: "enable",
            commandArgv: [],
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "The following Excluded services are currently not activated: \"serviceA\". Remove all Excluded services to prevent chs-dev state disarray."
        );
    });

    it("should warn when enabling development mode but service is not activated", async () => {

        // @ts-expect-error
        const result = await checkServiceModuleStateHook({
            activatedServices: [],
            topic: "development",
            command: "enable",
            commandArgv: ["serviceX"],
            config: {},
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "Service(s): \"serviceX\" does not appear to be enabled and might cause chs-dev to malfunction. Run: 'chs-dev services enable serviceX', then rerun the previous command."
        );
        expect(result.length).toBeGreaterThan(0);
    });

    it("should warn when adding service to exclusion but service is not activated", async () => {

        // @ts-expect-error
        const result = await checkServiceModuleStateHook({
            activatedServices: [],
            topic: "exclusions",
            command: "add",
            commandArgv: ["serviceX"],
            config: {},
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "Service(s): \"serviceX\" does not appear to be enabled and might cause chs-dev to malfunction. Run: 'chs-dev services enable serviceX', then rerun the previous command."
        );
        expect(result.length).toBeGreaterThan(0);
    });

    it("should not warn if all development mode and exclusion services are activated", async () => {
        const mockState = {
            snapshot: {
                servicesWithLiveUpdate: ["service-one"],
                excludedServices: ["service-one"]
            },
            excludeServiceFromLiveUpdate: jest.fn()
        };

        (StateManager as jest.Mock).mockImplementation(() => mockState);

        // @ts-expect-error
        await checkServiceModuleStateHook({
            activatedServices: ["service-one"],
            topic: "services",
            command: "enable",
            commandArgv: ["service-one"],
            config: {},
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });

});
