import { fetchDockerSettings } from "../../../helpers/docker-settings-store.js";
import { isOnVpn, isWebProxyHostSet } from "../../../helpers/vpn-check.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Check user's device proxy configuration";

const WEB_PROXY_SUGGESTION = [
    "Run echo $CH_PROXY_HOST to check web proxy value on device"
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

    async analyse (context: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {

        const vpnIssues = this.checkCHProxyConfig();
        const dockerIssues = this.checkDockerProxiesConfig();

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

    private checkDockerProxiesConfig (): AnalysisIssue | undefined {
        const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        const { OverrideProxyHTTP, OverrideProxyHTTPS, ProxyHTTPMode, ProxyHttpMode } = fetchDockerSettings();

        if (!(OverrideProxyHTTP === httpProxy && OverrideProxyHTTPS === httpProxy &&
            ProxyHTTPMode === "manual" && ProxyHttpMode === "manual")) {
            return {
                title: "Docker proxy settings invalid",
                description: `Docker proxy settings properties not configured correctly`,
                suggestions: DOCKER_PROXY_CONFIGURATION_SUGGESTIONS,
                documentationLinks: []
            };
        }
    }

}
