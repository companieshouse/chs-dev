import { DockerSettings, fetchDockerSettings } from "../../../helpers/docker-settings-store.js";
import { isIbossEnabled } from "../../../helpers/iboss-status.js";
import { isOnVpn, isWebProxyHostSet } from "../../../helpers/vpn-check.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
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

export default class ProxiesConfiguredCorrectlyAnalysis extends BaseAnalysis {

    async analyse (context: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        if (isIbossEnabled()) {
            return this.createOutcomeFrom(ANALYSIS_HEADLINE, []);
        }
        const vpnIssues = this.checkCHProxyConfig();
        const dockerIssues = this.checkDockerProxiesConfig();

        const issues: AnalysisIssue[] = [vpnIssues, dockerIssues].filter((issue): issue is AnalysisIssue => issue !== undefined);

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, "Fail");
    }

    private checkCHProxyConfig (): AnalysisIssue | undefined {
        if (isWebProxyHostSet()) {
            if (!isOnVpn()) {
                return this.createIssue(
                    "CH_PROXY_HOST ping unsuccessful",
                    `Ping on webproxy not successful`,
                    WEB_PROXY_SUGGESTION
                );
            }
        } else {
            return this.createIssue(
                "CH_PROXY_HOST env not set",
                `CH_PROXY_HOST value missing in env.`,
                WEB_PROXY_SUGGESTION
            );

        }
    }

    private checkDockerProxiesConfig (): AnalysisIssue | undefined {
        const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        const result = fetchDockerSettings();
        const { OverrideProxyHTTP, OverrideProxyHTTPS, ProxyHTTPMode, ProxyHttpMode } = result as DockerSettings;
        const issues = result as AnalysisIssue;

        if (!issues.title) {
            if (!(OverrideProxyHTTP === httpProxy && OverrideProxyHTTPS === httpProxy &&
                ProxyHTTPMode === "manual" && ProxyHttpMode === "manual")) {
                return this.createIssue(
                    "Docker proxy settings invalid",
                    `Docker proxy settings properties not configured correctly`,
                    DOCKER_PROXY_CONFIGURATION_SUGGESTIONS
                );
            }
        } else {
            return issues;
        }

    }

}
