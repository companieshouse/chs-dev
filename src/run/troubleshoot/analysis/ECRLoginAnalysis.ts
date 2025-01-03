import { existsSync } from "fs";
import { join } from "path";
import { ThresholdUnit, timeWithinThreshold } from "../../../helpers/time-within-threshold.js";
import Config from "../../../model/Config.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks the ECR login status of User";

const ECR_LOGIN_SUGGESTIONS = [];

const DOCUMENTATION_LINKS = [];

/**
 * An analysis task that evaluates whether the user is logged into ECR.
 * It checks the user's ECR login status using the last runtime file and a threshold configuration for the verification of a current or previous login.
 */

export default class EcrLoginAnalysis extends BaseAnalysis {

    async analyse ({ inventory, stateManager, config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const issues = await this.checkUserEcrLoginStatus(config);

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, "Fail");
    }

    async checkUserEcrLoginStatus (config: Config): Promise<AnalysisIssue | undefined> {
        const { projectName, performEcrLoginHoursThreshold, chsDevDataDir } = config;
        const executionTime = Date.now();

        if (chsDevDataDir) {
            const lastRunTimeFile = join(chsDevDataDir, `${projectName}.prerun.last_run_time`);

            const lastRuntimeExists = existsSync(lastRunTimeFile);

            const isUserEcrLoginValid = lastRuntimeExists && timeWithinThreshold(
                lastRunTimeFile,
                executionTime,
                performEcrLoginHoursThreshold as number,
                ThresholdUnit.HOURS
            );

            if (!isUserEcrLoginValid) {
                return {
                    title: "User Not Logged into ECR",
                    description: "The login logs indicate that the user is either not logged in or the login session has expired.",
                    suggestions: ECR_LOGIN_SUGGESTIONS,
                    documentationLinks: DOCUMENTATION_LINKS
                };

            }

        } else {
            return {
                title: "ECR Login Status Check Failed",
                description: "Unable to perform check. DataDir path is missing from configuration.",
                suggestions: ECR_LOGIN_SUGGESTIONS,
                documentationLinks: DOCUMENTATION_LINKS
            };
        }

    }

}
