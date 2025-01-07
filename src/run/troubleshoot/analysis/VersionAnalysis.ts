import { diff, satisfies } from "semver";
import { getLatestReleaseVersion } from "../../../helpers/latest-release.js";
import Config from "../../../model/Config.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks chs-dev version";

const VERSION_SUGGESTIONS = [
    "Run: chs-dev sync to update chs-dev to a suitable version. Refer to the documentation for guidance."
];

const DOCUMENTATION_LINKS = [
    "troubleshooting-remedies/correctly-upgrade-chs-dev-version.md"
];

/**
 * An analysis task that evaluates whether the chs-dev version  meets the required specification and the latest.
 */
export default class VersionAnalysis extends BaseAnalysis {
    async analyse ({ config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const issues = await this.checkVersionCompliance(config);
        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, "Warn");
    }

    /**
     * Checks if the current chs-dev version meets the required specifications and is up-to-date.
     * @param {Config} params - properties required for the check:
     * @param {string} versionSpecification -  required application versions
     * @param {string} chsDevVersion - current application version
     * @returns {AnalysisIssue[] | AnalysisIssue} - returns Object Array of issues or a single issue
     */
    private async checkVersionCompliance (config: Config): Promise<AnalysisIssue[] | AnalysisIssue> {
        const issues: AnalysisIssue[] = [];

        const { versionSpecification, chsDevVersion: appVersion } = config;
        if (!appVersion || !versionSpecification) {
            return this.createIssue(
                "chs-dev version check failed",
                "Unable to perform check. The version property is missing from configuration."
            );
        }

        const versionRequirementIssue = this.checkVersionSpecification(versionSpecification, appVersion);
        if (versionRequirementIssue) {
            issues.push(versionRequirementIssue);
        }

        const latestVersionIssue = await this.checkIfVersionIsLatest(appVersion);
        if (latestVersionIssue) {
            issues.push(latestVersionIssue);
        }

        return issues;
    }

    /**
     * Checks if the current version satisfies the project's version specification.
     * @param {string} versionSpecification: required application versions
     * @param {string} appVersion - current application version
     * @returns {AnalysisIssue | undefined} - returns an single issue or undefined
     */
    private checkVersionSpecification (versionSpecification:string, appVersion:string): AnalysisIssue | undefined {

        if (!satisfies(appVersion, versionSpecification)) {
            return this.createIssue(
                "chs-dev version does not meet the project requirements",
                `The current application version is ${appVersion}, but the required version is ${versionSpecification}. Upgrade your chs-dev version.`,
                VERSION_SUGGESTIONS,
                DOCUMENTATION_LINKS
            );
        }

        return undefined;
    }

    /**
     * Checks if the current version is the latest available.
     * @param {string} appVersion - current application version
     * @returns { Promise<AnalysisIssue | undefined> } -  returns a single issue or undefined as promise
     */
    private async checkIfVersionIsLatest (appVersion: string): Promise<AnalysisIssue | undefined> {

        const latestVersion = await getLatestReleaseVersion();
        const semverDifference = diff(latestVersion, appVersion);

        if (semverDifference !== null) {
            return this.createIssue(
                "chs-dev version not latest",
                `A newer version (${latestVersion}) is available (current version: ${appVersion}).`,
                VERSION_SUGGESTIONS,
                DOCUMENTATION_LINKS
            );
        }

        return undefined;
    }
}
