import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";
import AnalysisOutcome from "./AnalysisOutcome.js";

type DockerSettingsInterface = {
    OverrideProxyHTTP: string;
    OverrideProxyHTTPS: string;
    ProxyHttpMode: string
    ProxyHTTPMode: string
}

const ANALYSIS_HEADLINE = "Check user's device proxy configuration";
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

    async analyse (): Promise<AnalysisOutcome> {
        const dockerIssues = this.checkDockerProxiesConfig();

        const issues: AnalysisIssue[] = dockerIssues ? [dockerIssues] : [];

        return this.createOutcomeFrom(issues);
    }

    private createOutcomeFrom (issues: AnalysisIssue[]): AnalysisOutcome | PromiseLike<AnalysisOutcome> {
        return issues.length > 0
            ? AnalysisOutcome.createFailed(ANALYSIS_HEADLINE, issues)
            : AnalysisOutcome.createSuccessful(ANALYSIS_HEADLINE);
    }

    private checkDockerProxiesConfig (): AnalysisIssue | undefined {
        const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        const settingsFilePath = this.getDockerSettingsFilePath;

        if (!fs.existsSync(settingsFilePath)) {
            return {
                title: "Docker settings file not found on user's device",
                description: `invalid file path ${settingsFilePath}`,
                suggestions: DOCKER_SETTINGS_FILE_SUGGESTIONS,
                documentationLinks: []
            };
        }

        const fileContents = fs.readFileSync(settingsFilePath, "utf-8");
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

    private get getDockerSettingsFilePath (): string {
        const homeDir = process.env.HOME || os.homedir();
        switch (process.platform) {
        case "win32":
            return path.join(homeDir, "AppData", "Roaming", "Docker", "settings-store.json");
        case "darwin":
            return path.join(homeDir, "Library", "Group Containers", "group.com.docker", "settings-store.json");
        case "linux":
            return path.join(homeDir, ".docker", "desktop", "settings-store.json");
        default:
            throw new Error("Unsupported operating system.");
        }
    }

}
