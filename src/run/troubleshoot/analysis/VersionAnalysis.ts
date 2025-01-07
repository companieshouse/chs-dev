import { diff, satisfies } from "semver";
import { getLatestReleaseVersion } from "../../../helpers/latest-release.js";
import Config from "../../../model/Config.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

interface VersionComplianceIssues {
    missingConfigIssue?: AnalysisIssue | undefined
    invalidVersionIssue?: AnalysisIssue | undefined
    latestVersionIssue?: AnalysisIssue | undefined
}

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

    /**
     * Analyzes the configuration to determine compliance with version requirements.
     *
     * This method evaluates the configuration for potential issues, such as missing or invalid version requirements and whether the application version is up-to-date. Depending on the findings, it generates either a "Fail" or "Warn" outcome.
     *
     * @returns {Promise<AnalysisOutcome>} A promise that resolves to an `AnalysisOutcome`, which contains either:
     * - Fail issues if critical problems are found (e.g., missing configuration or invalid version).
     * - Warn issues if less critical problems are found (e.g., outdated application version).
     */
    async analyse ({ config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const { missingConfigIssue, invalidVersionIssue, latestVersionIssue } = await this.checkVersionCompliance(config);

        const failIssues: AnalysisIssue[] = [missingConfigIssue, invalidVersionIssue].filter(Boolean) as AnalysisIssue[];
        const warnIssues: AnalysisIssue[] = latestVersionIssue ? [latestVersionIssue] : [];

        const issues = failIssues.length ? failIssues : warnIssues;
        const level = failIssues.length ? "Fail" : "Warn";

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, level);

    }

    /**
     * Checks if the current chs-dev version meets the required specifications and is up-to-date.
     * @param {Config} params - properties required for the check:
     * @param {string} versionSpecification -  required application versions
     * @param {string} chsDevVersion - current application version
     * @returns {VersionComplianceIssues} - returns VersionComplianceIssues
     */
    private async checkVersionCompliance (config: Config): Promise<VersionComplianceIssues> {
        const issues = { } as VersionComplianceIssues;

        const { versionSpecification, chsDevVersion: appVersion } = config;
        if (!appVersion || !versionSpecification) {
            return {
                missingConfigIssue: this.createIssue(
                    "chs-dev version check failed",
                    "Unable to perform check. The version property is missing from configuration."
                )
            };
        }

        const versionRequirementIssue = this.checkVersionSpecification(versionSpecification, appVersion);
        if (versionRequirementIssue) {
            issues.invalidVersionIssue = versionRequirementIssue;
        }

        const latestVersionIssue = await this.checkIfVersionIsLatest(appVersion);
        if (latestVersionIssue) {
            issues.latestVersionIssue = latestVersionIssue;
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
