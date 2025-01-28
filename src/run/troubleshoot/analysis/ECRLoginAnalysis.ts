import { hasValidEcrLoginWithinThreshold } from "../../../helpers/ecr-login.js";
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

    private async checkUserEcrLoginStatus (config: Config): Promise<AnalysisIssue | undefined> {
        const { chsDevDataDir } = config;
        if (chsDevDataDir) {
            const isUserEcrLoginValid = hasValidEcrLoginWithinThreshold(config);
            if (!isUserEcrLoginValid) {
                return this.createIssue(
                    "User Not Logged into ECR",
                    "The login logs indicate that the user is either not logged in or the login session has expired.",
                    ECR_LOGIN_SUGGESTIONS,
                    DOCUMENTATION_LINKS
                );

            }

        } else {
            return this.createIssue(
                "ECR Login Status Check Failed",
                "Unable to perform check. DataDir path is missing from configuration.",
                ECR_LOGIN_SUGGESTIONS,
                DOCUMENTATION_LINKS
            );

        }

    }

}
