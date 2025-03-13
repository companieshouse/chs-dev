import { execSync } from "child_process";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks AWS environment variable is set correctly";

const SUGGESTIONS = [
    "Run the below command to set the AWS_PROFILE:",
    "`export AWS_PROFILE=development-eu-west-2`"
];

const DOCUMENTATION_LINKS = [
    "troubleshooting-remedies/correctly-set-aws-environment-variables.md"
];

/**
 * An analysis task that evaluates whether the required AWS environment variable is set or  configured correctly.
 */
export default class AwsEnvironmentVariableAnalysis extends BaseAnalysis {

    async analyse ({ config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const profileIssue = this.checkAwsProfileEnvVariable();

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, profileIssue, "Fail");
    }

    /**
     * Checks the AWS_PROFILE environment variable value
     * Ensures the value is set and is one of the available profiles
     * @returns { Promise<AnalysisIssue | undefined> } - Returns an issue if value is unset or not one of the available profile, otherwise undefined
     */
    private checkAwsProfileEnvVariable (): AnalysisIssue | undefined {
        const AWS_PROFILE = process.env.AWS_PROFILE;
        const profiles = this.fetchAwsProfiles();

        if (!AWS_PROFILE || !profiles.includes(AWS_PROFILE)) {
            return this.createIssue(
                "AWS_PROFILE environment variable was overwritten or not set",
                "Ensure 'AWS_PROFILE' environment variable is set to one of the following profiles: " + profiles.join(", "),
                SUGGESTIONS,
                DOCUMENTATION_LINKS
            );
        }
        return undefined;
    }

    private fetchAwsProfiles (): string[] {
        try {
            return execSync("aws configure list-profiles", { encoding: "utf-8" })
                .split("\n")
                .filter(Boolean);
        } catch (error) {
            throw new Error(`Error fetching AWS profiles:: ${error}.`);
        }
    }
}
