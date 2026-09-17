import { getItemFromKeyChain } from "../../../helpers/keychain.js";
import CONSTANTS from "../../../model/Constants.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks SSH key passphrase is set";
const SUGGESTIONS = [
    "Run 'bin/init' in the 'docker-chs-development' project directory to set the SSH key passphrase."
];

export default class SSHKeyPassphraseAnalysis extends BaseAnalysis {
    async analyse (_context: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        if (process.platform !== "darwin") {
            return this.createOutcomeFrom(ANALYSIS_HEADLINE, undefined);
        }

        const passphrase = await getItemFromKeyChain(CONSTANTS.SSH_PASSWORD_KEYCHAIN_ITEM_NAME);
        const issue: AnalysisIssue | undefined = passphrase
            ? undefined
            : this.createIssue(
                "SSH key passphrase not set",
                "SSH key passphrase is not set. Rerun the init script for 'docker-chs-development' to set it.",
                SUGGESTIONS
            );

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issue, "Fail");
    }
}
