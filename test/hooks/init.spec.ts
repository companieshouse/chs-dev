import { beforeAll, expect, jest } from "@jest/globals";
import { Hook, Config } from "@oclif/core";
import { getLatestReleaseVersion as getLatestReleaseVersionMock } from "../../src/helpers/latest-release";
import { isOnVpn as isOnVpnMock } from "../../src/helpers/vpn-check";
import configLoaderMock from "../../src/helpers/config-loader";
import { hookFilter as hookFilterMock } from "../../src/hooks/hook-filter";

jest.mock("../../src/helpers/latest-release");
jest.mock("../../src/helpers/config-loader");
jest.mock("../../src/helpers/vpn-check");
jest.mock("../../src/hooks/hook-filter");

const versionCheckRunMock = jest.fn();

jest.mock("../../src/run/version-check", () => {
    return {
        VersionCheck: {
            create: () => ({
                run: versionCheckRunMock
            })
        }
    };
});

describe("init hook", () => {

    let testConfig: Config;
    let initHook: Hook<"init">;
    const runHookMock = jest.fn();

    const version = "1.1.1";

    const pjson = {
        "chs-dev": {
            "version-check-schedule": {
                "number-of-days": 14
            }
        }
    };

    beforeAll(async () => {

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", dataDir: "./data", version, pjson, runHook: runHookMock };

        initHook = (await import("../../src/hooks/init")).hook;
    });

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        configLoaderMock.mockReturnValue({
            projectPath: "/home/project"
        });
        // @ts-expect-error
        hookFilterMock.mockReturnValue(true);
    });

    it("does nothing when hookFilter returns false", async () => {
        // @ts-expect-error
        hookFilterMock.mockReturnValue(false);

        const context: unknown = {
            warn: jest.fn()
        };

        await initHook.bind(context as Hook.Context)({
            config: testConfig,
            id: "",
            argv: [],
            context: context as unknown as Hook.Context
        });

        expect(versionCheckRunMock).not.toHaveBeenCalled();
        expect(getLatestReleaseVersionMock).not.toHaveBeenCalled();
        expect(isOnVpnMock).not.toHaveBeenCalled();
    });

    it("runs version check", async () => {
        const context: unknown = {
            warn: jest.fn()
        };

        await initHook.bind(context as Hook.Context)({
            config: testConfig,
            id: "",
            argv: [],
            context: context as unknown as Hook.Context
        });

        expect(versionCheckRunMock).toHaveBeenCalledWith(version);
    });

    it("checks whether on VPN", async () => {
        // @ts-expect-error
        getLatestReleaseVersionMock.mockResolvedValue("0.9.23");

        process.env.CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING = "true";

        const context: unknown = {
            warn: jest.fn()
        };

        await initHook.bind(context as Hook.Context)({
            config: testConfig,
            id: "",
            argv: [],
            context: context as unknown as Hook.Context
        });

        expect(isOnVpnMock).toHaveBeenCalled();
    });

    it("logs statement when not on vpn", async () => {
        // @ts-expect-error
        isOnVpnMock.mockReturnValueOnce(false);

        // @ts-expect-error
        getLatestReleaseVersionMock.mockResolvedValue("0.9.23");

        process.env.CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING = "true";

        const context = {
            warn: jest.fn()
        };

        await initHook.bind(context as unknown as Hook.Context)({
            config: testConfig,
            id: "",
            argv: [],
            context: context as unknown as Hook.Context
        });

        expect(context.warn).toHaveBeenCalledWith(
            `Not on VPN. Some containers may not build properly.`
        );
    });

    it("does not log statement when on vpn", async () => {
        // @ts-expect-error
        isOnVpnMock.mockReturnValue(true);

        // @ts-expect-error
        getLatestReleaseVersionMock.mockResolvedValue("0.9.23");

        process.env.CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING = "true";

        const context = {
            warn: jest.fn()
        };

        await initHook.bind(context as unknown as Hook.Context)({
            config: testConfig,
            id: "",
            argv: [],
            context: context as unknown as Hook.Context
        });

        expect(context.warn).not.toHaveBeenCalledWith(
            `WARNING - not on VPN. Some containers may not build properly.`
        );
    });

    it("runs the validate-project-state hook", async () => {
        const context: unknown = {
            warn: jest.fn()
        };

        await initHook.bind(context as Hook.Context)({
            config: testConfig,
            id: "",
            argv: [],
            context: context as unknown as Hook.Context
        });

        expect(runHookMock).toHaveBeenCalledWith("validate-project-state", {
            requiredFiles: [
                "services"
            ]
        });
    });

});
