import { expect, jest } from "@jest/globals";
import { services, modules } from "../utils/data";
import { StateManager } from "../../src/state/state-manager";
import { Inventory } from "../../src/state/inventory";
import checkServiceDevelopmentStatusHook from "../../src/hooks/check-service-or-module-status";
import { Config } from "@oclif/core";
import configLoaderMock from "../../src/helpers/config-loader";
import ChsDevConfig from "../../src/model/Config";

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

const context = {
    runHook: jest.fn(),
    runCommand: jest.fn(),
    warn: jest.fn()
};

const testConfig: ChsDevConfig = {
    projectName: "chs-dev-proj",
    projectPath: "/home/test-user/projects/chs-dev-proj",
    env: {}
};

jest.mock("../../src/state/state-manager");
jest.mock("../../src/state/inventory");
jest.mock("../../src/helpers/config-loader");

describe("check-service-or-module-status", () => {
    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        StateManager.mockReturnValue(stateManagerMock);

        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        // @ts-expect-error
        configLoaderMock.mockReturnValue(testConfig);
    });

    it("logs message when the service being enabled is also in development mode", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-three"],
            topic: "services",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "Service: service-three is currently in development mode; run: " +
            "'chs-dev development disable service-three' to run from " +
            "the image held in the registry."
        );
    });

    it("handles multiple services being enabled", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-three", "service-eight"],
            topic: "services",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledTimes(2);

        expect(context.warn).toHaveBeenCalledWith(
            "Service: service-three is currently in development mode; run: " +
            "'chs-dev development disable service-three' to run from " +
            "the image held in the registry."
        );

        expect(context.warn).toHaveBeenCalledWith(
            "Service: service-eight is currently in development mode; run: " +
            "'chs-dev development disable service-eight' to run from " +
            "the image held in the registry."
        );
    });

    it("logs message when the service being enabled in development mode is not enabled as a service", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-eighteen"],
            topic: "development",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "Service: service-eighteen does not appear to be enabled as a " +
            "service. Run: 'chs-dev services enable service-eighteen' to " +
            "run this service in development mode."
        );
    });

    it("handles multiple services being enabled in development mode", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-eighteen", "service-twenty"],
            topic: "development",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledTimes(2);

        expect(context.warn).toHaveBeenCalledWith(
            "Service: service-eighteen does not appear to be enabled as a " +
            "service. Run: 'chs-dev services enable service-eighteen' to " +
            "run this service in development mode."
        );

        expect(context.warn).toHaveBeenCalledWith(
            "Service: service-twenty does not appear to be enabled as a " +
            "service. Run: 'chs-dev services enable service-twenty' to " +
            "run this service in development mode."
        );
    });

    it("does not log message when disabling service", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-three"],
            topic: "services",
            command: "disable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });

    it("does not log message when removing service from development mode", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-three"],
            topic: "development",
            command: "disable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });

    it("does not log message when service being enabled is not in development mode", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-one"],
            topic: "services",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });

    it("does not log message when service being added to development mode is enabled", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-six"],
            topic: "development",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });

    it("does not log message when service being added to development mode is part of enabled module", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-one"],
            topic: "development",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });

    it("does not log message when topic is not services or development", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-two"],
            topic: "exclusions",
            command: "include",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });

    it("warns when enabling a service which is excluded", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            services: ["service-two"],
            topic: "services",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "Service: service-two is currently excluded and so enabling the " +
            "service has no effect. To remove the exclusion run " +
            "'chs-dev exclusions remove service-two'"
        );
    });

    it("warns when enabling a module which has excluded services", async () => {
        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            modules: ["module-three"],
            topic: "modules",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).toHaveBeenCalledWith(
            "Module: module-three contains the services: service-nine which " +
            "has been excluded. Remove the exclusion if you require these " +
            "services to be included. To remove run: " +
            "'chs-dev exclusion remove <service>'"
        );
    });

    it("does not log when enabling a module with no services currently excluded", async () => {

        // @ts-expect-error
        await checkServiceDevelopmentStatusHook({
            modules: ["module-two"],
            topic: "modules",
            command: "enable",
            config: {
                cacheDir: "/home/test-user/.caches/proj"
            } as Config,
            context
        });

        expect(context.warn).not.toHaveBeenCalled();
    });
});
