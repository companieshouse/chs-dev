import * as fs from "fs";
import { expect, jest } from "@jest/globals";
import ProxiesConfiguredCorrectlyAnalysis from "../../../../src/run/troubleshoot/analysis/ProxiesConfiguredCorrectlyAnalysis";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";

jest.mock("fs");

describe("ProxiesConfiguredCorrectlyAnalysis", () => {
    const mockDockerSettingsPath = "/mock/docker/settings-store.json";

    let analysis: ProxiesConfiguredCorrectlyAnalysis;

    beforeEach(() => {
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

        const context = {
            config: { dockerSettingsPath: mockDockerSettingsPath }
        } as TroubleshootAnalysisTaskContext;

        const outcome = await analysis.analyse(context);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

    it("should return a failed outcome if the Docker settings file is missing", async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const context = {
            config: { dockerSettingsPath: mockDockerSettingsPath }
        } as TroubleshootAnalysisTaskContext;

        const outcome = await analysis.analyse(context);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "Docker settings file not found on user's device",
                description: `invalid file path ${mockDockerSettingsPath}`,
                suggestions: ["Check file path to docker 'settings-store.json'"],
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

        const context = {
            config: { dockerSettingsPath: mockDockerSettingsPath }
        } as TroubleshootAnalysisTaskContext;

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
