import { expect, jest } from "@jest/globals";
import * as fs from "fs";
import { isOnVpn, isWebProxyHostSet } from "../../../../src/helpers/vpn-check";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import ProxiesConfiguredCorrectlyAnalysis from "../../../../src/run/troubleshoot/analysis/ProxiesConfiguredCorrectlyAnalysis";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";

jest.mock("fs");
jest.mock("../../../../src/helpers/vpn-check", () => ({
    isWebProxyHostSet: jest.fn(),
    isOnVpn: jest.fn()
}));

describe("ProxiesConfiguredCorrectlyAnalysis", () => {
    let analysis: ProxiesConfiguredCorrectlyAnalysis;
    const WEB_PROXY_SUGGESTION = [
        "Run echo $CH_PROXY_HOST to check web proxy value on device"
    ];

    beforeEach(async () => {
        analysis = new ProxiesConfiguredCorrectlyAnalysis();
        jest.resetAllMocks();

    });

    it("should return a successful outcome if no issues are found", async () => {
        process.env.HTTPS_PROXY = "http://proxy.example.com";

        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({
                OverrideProxyHTTP: "http://proxy.example.com",
                OverrideProxyHTTPS: "http://proxy.example.com",
                ProxyHttpMode: "manual",
                ProxyHTTPMode: "manual"
            })
        );

        (isWebProxyHostSet as jest.Mock).mockReturnValue(true);
        (isOnVpn as jest.Mock).mockReturnValue(true);

        const context = { } as TroubleshootAnalysisTaskContext;
        const outcome = await analysis.analyse(context);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

    it("should return an issue if CH_PROXY_HOST is not set", async () => {
        process.env.HTTPS_PROXY = "http://proxy.example.com";

        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({
                OverrideProxyHTTP: "http://proxy.example.com",
                OverrideProxyHTTPS: "http://proxy.example.com",
                ProxyHttpMode: "manual",
                ProxyHTTPMode: "manual"
            })
        );

        delete process.env.CH_PROXY_HOST;
        (isWebProxyHostSet as jest.Mock).mockReturnValue(false);

        const context = { } as TroubleshootAnalysisTaskContext;
        const outcome = await analysis.analyse(context);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "CH_PROXY_HOST env not set",
                description: "CH_PROXY_HOST value missing in env.",
                suggestions: WEB_PROXY_SUGGESTION,
                documentationLinks: []
            }
        ]);
    });

    it("should return an issue if CH_PROXY_HOST ping fails (not on VPN)", async () => {
        process.env.HTTPS_PROXY = "http://proxy.example.com";
        process.env.CH_PROXY_HOST = "websenseproxy.internal.ch";

        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({
                OverrideProxyHTTP: "http://proxy.example.com",
                OverrideProxyHTTPS: "http://proxy.example.com",
                ProxyHttpMode: "manual",
                ProxyHTTPMode: "manual"
            })
        );

        (isWebProxyHostSet as jest.Mock).mockReturnValue(true);
        (isOnVpn as jest.Mock).mockReturnValue(false);

        const context = { } as TroubleshootAnalysisTaskContext;
        const outcome = await analysis.analyse(context);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "CH_PROXY_HOST ping unsuccessful",
                description: "Ping on webproxy not successful",
                suggestions: WEB_PROXY_SUGGESTION,
                documentationLinks: []
            }
        ]);
    });

    it("should return a failed outcome if Docker proxy settings are invalid", async () => {
        process.env.HTTPS_PROXY = "http://proxy.example.com";

        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({
                OverrideProxyHTTP: "http://proxy.example.com",
                OverrideProxyHTTPS: "http://another-proxy.example.com",
                ProxyHttpMode: "auto",
                ProxyHTTPMode: "manual"
            })
        );

        (isWebProxyHostSet as jest.Mock).mockReturnValue(true);
        (isOnVpn as jest.Mock).mockReturnValue(true);

        const context = { } as TroubleshootAnalysisTaskContext;
        const outcome = await analysis.analyse(context);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "Docker proxy settings invalid",
                description: "Docker proxy settings properties not configured correctly",
                suggestions: [
                    "Run 'chproxyon' to set ProxyHttpMode for docker",
                    "'ProxyHttpMode' property in docker settings-store.json file must be set to 'manual'",
                    "'ProxyHTTPMode' property in docker settings-store.json file must be set to 'manual'",
                    "Run echo $HTTPS_PROXY to check web proxy value on device",
                    "'OverrideProxyHTTP' property in docker settings-store.json file must correctly match 'HTTPS_PROXY' value",
                    "'OverrideProxyHTTPS' property in docker settings-store.json file must correctly match 'HTTPS_PROXY' value"
                ],
                documentationLinks: []
            }
        ]);
    });

});
