import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Hook, IConfig } from "@oclif/config";
// @ts-expect-error
import { rmSync } from "fs";
import { getLatestReleaseVersion as getLatestReleaseVersionMock } from "../../src/helpers/latest-release";
import { isOnVpn as isOnVpnMock } from "../../src/helpers/vpn-check";

jest.mock("../../src/helpers/latest-release");
jest.mock("../../src/helpers/config-loader");
jest.mock("../../src/helpers/vpn-check");

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

    let testConfig: IConfig;
    let initHook: Hook<"init">;

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
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", dataDir: "./data", version, pjson };

        initHook = (await import("../../src/hooks/init")).hook;
    });

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("runs version check", async () => {
        const context: unknown = {
            warn: jest.fn()
        };

        await initHook.bind(context as Hook.Context)({
            config: testConfig,
            id: "",
            argv: []
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
            argv: []
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
            argv: []
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
            argv: []
        });

        expect(context.warn).not.toHaveBeenCalledWith(
            `WARNING - not on VPN. Some containers may not build properly.`
        );
    });

});
