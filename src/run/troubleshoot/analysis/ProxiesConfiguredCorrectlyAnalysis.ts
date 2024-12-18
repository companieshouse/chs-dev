import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { isOnVpn, isWebProxyHostSet } from "../../../helpers/vpn-check.js";

type DockerSettingsInterface = {
    OverrideProxyHTTP: string;
    OverrideProxyHTTPS: string;
    ProxyHttpMode: string
    ProxyHTTPMode: string
}

const ANALYSIS_HEADLINE = "Check user's device proxy configuration";

const WEB_PROXY_SUGGESTION = [
    "Run echo $CH_PROXY_HOST to check web proxy value on device"
];

const DOCKER_SETTINGS_FILE_SUGGESTIONS = [
    "Check file path to docker 'settings-store.json'"
];
const DOCKER_PROXY_CONFIGURATION_SUGGESTIONS = [
    "Run 'chproxyon' to set ProxyHttpMode for docker",
    "'ProxyHttpMode' property in docker settings-store.json file must be set to 'manual'",
    "'ProxyHTTPMode' property in docker settings-store.json file must be set to 'manual'",
    "Run echo $HTTPS_PROXY to check web proxy value on device",
    "'OverrideProxyHTTP' property in docker settings-store.json file must correctly match 'HTTPS_PROXY' value",
    "'OverrideProxyHTTPS' property in docker settings-store.json file must correctly match 'HTTPS_PROXY' value"
];

/**
 * An analysis task which checks whether the proxy configuration for the user device are configured correctly.
 */

export default class ProxiesConfiguredCorrectlyAnalysis {

    async analyse ({ config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const { dockerSettingsPath } = config;
        const vpnIssues = this.checkCHProxyConfig();
        const dockerIssues = this.checkDockerProxiesConfig(dockerSettingsPath);

        const issues: AnalysisIssue[] = [vpnIssues, dockerIssues].filter((issue): issue is AnalysisIssue => issue !== undefined);

        return this.createOutcomeFrom(issues);
    }

    private createOutcomeFrom (issues: AnalysisIssue[]): AnalysisOutcome | PromiseLike<AnalysisOutcome> {
        return issues.length > 0
            ? AnalysisOutcome.createFailed(ANALYSIS_HEADLINE, issues)
            : AnalysisOutcome.createSuccessful(ANALYSIS_HEADLINE);
    }

    private checkCHProxyConfig (): AnalysisIssue | undefined {
        if (isWebProxyHostSet()) {
            if (!isOnVpn()) {
                return {
                    title: "CH_PROXY_HOST ping unsuccessful",
                    description: `Ping on webproxy not successful`,
                    suggestions: WEB_PROXY_SUGGESTION,
                    documentationLinks: []
                };
            }
        } else {
            return {
                title: "CH_PROXY_HOST env not set",
                description: `CH_PROXY_HOST value missing in env.`,
                suggestions: WEB_PROXY_SUGGESTION,
                documentationLinks: []
            };
        }
    }

    private checkDockerProxiesConfig (dkSettingsPath): AnalysisIssue | undefined {
        const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

        if (!fs.existsSync(dkSettingsPath)) {
            return {
                title: "Docker settings file not found on user's device",
                description: `invalid file path ${dkSettingsPath}`,
                suggestions: DOCKER_SETTINGS_FILE_SUGGESTIONS,
                documentationLinks: []
            };
        }

        const fileContents = fs.readFileSync(dkSettingsPath, "utf-8");
        const settings:DockerSettingsInterface = JSON.parse(fileContents);

        if (
            !(
                settings.OverrideProxyHTTP === httpProxy &&
                settings.OverrideProxyHTTPS === httpProxy &&
                settings.ProxyHTTPMode === "manual" &&
                settings.ProxyHttpMode === "manual"
            )
        ) {

            return {
                title: "Docker proxy settings invalid",
                description: `Docker proxy settings properties not configured correctly`,
                suggestions: DOCKER_PROXY_CONFIGURATION_SUGGESTIONS,
                documentationLinks: []
            };

        }

    }

}
