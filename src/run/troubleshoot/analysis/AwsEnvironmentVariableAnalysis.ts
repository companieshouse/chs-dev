import { execSync } from "child_process";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks AWS environment variables";

const SUGGESTIONS = [
    "Run the below command to set the AWS profile or AWS region:",
    "`export AWS_PROFILE=development-eu-west-2` or `export _AWS_REGION=eu-west-2`"
];

const DOCUMENTATION_LINKS = [
    "troubleshooting-remedies/correctly-add-aws-environment-variables.md"
];

/**
 * An analysis task that evaluates whether the required AWS environment variables are set or correctly configured.
 */
export default class AwsEnvironmentVariableAnalysis extends BaseAnalysis {

    async analyse ({ config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const profileIssues = this.checkAwsProfileEnvVariables();

        const issues = profileIssues || this.checkAwsRegionEnvVariables();
        const level = profileIssues ? "Fail" : "Warn";

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, level);
    }

    /**
     * Checks the AWS_PROFILE environment variable value
     * Ensures the value is set and is one of the available profiles
     * @returns { Promise<AnalysisIssue | undefined> } - Returns an issue if value is unset or not one of the available profile, otherwise undefined
     */
    private checkAwsProfileEnvVariables (): AnalysisIssue | undefined {
        const AWS_PROFILE = process.env.AWS_PROFILE;
        const _AWS_PROFILE = process.env._AWS_PROFILE;
        const _DEFAULT_AWS_PROFILE = process.env._DEFAULT_AWS_PROFILE;
        const profile = this.getAwsProfiles;

        const isInvalidAwsProfile = (value:string | undefined):boolean => {
            return !value || !profile.includes(value);
        };

        if (isInvalidAwsProfile(AWS_PROFILE) || isInvalidAwsProfile(_AWS_PROFILE) || isInvalidAwsProfile(_DEFAULT_AWS_PROFILE)) {
            return this.createIssue(
                "AWS_PROFILE environment variables are invalid or not set",
                "Ensure the 'AWS_PROFILE', '_AWS_PROFILE', '_DEFAULT_AWS_PROFILE' environment variables are set to one of the following profiles: " + profile.join(", "),
                SUGGESTIONS,
                DOCUMENTATION_LINKS
            );
        }
        return undefined;
    }

    /**
     * Checks the _AWS_REGION environment variable value
     * Ensures the value is set to the correct region
     * @returns { Promise<AnalysisIssue | undefined> } - Returns an issue if value is unset or not the correct region, otherwise undefined
     */
    private checkAwsRegionEnvVariables (): AnalysisIssue | undefined {
        const _AWS_REGION = process.env._AWS_REGION;
        const _DEFAULT_AWS_REGION = process.env._DEFAULT_AWS_REGION;
        const region = this.getAwsRegion;

        const isInvalidAwsRegion = (value:string | undefined):boolean => {
            return region !== value;
        };

        if (isInvalidAwsRegion(_AWS_REGION) || isInvalidAwsRegion(_DEFAULT_AWS_REGION)) {
            return this.createIssue(
                "AWS_REGION environment variables are invalid or not set",
                "Ensure the '_AWS_REGION', '_DEFAULT_AWS_REGION' environment variables are set to region: " + region,
                SUGGESTIONS,
                DOCUMENTATION_LINKS
            );
        }
        return undefined;

    };

    private get getAwsProfiles (): string[] {
        return execSync("aws configure list-profiles", { encoding: "utf-8" })
            .split("\n")
            .filter(Boolean);
    }

    private get getAwsRegion (): string {
        return execSync("aws configure get region", { encoding: "utf-8" }).trim();
    }
}
