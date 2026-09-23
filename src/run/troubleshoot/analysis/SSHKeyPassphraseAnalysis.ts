import { getItemFromKeyChain } from "../../../helpers/keychain.js";
import CONSTANTS from "../../../model/Constants.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks SSH key passphrase is set";
const SUGGESTIONS = [
    "Run 'bin/init' in the 'docker-chs-development' project directory to set the SSH key passphrase."
];

/**
 * An analysis task that evaluates whether the SSH key passphrase has been
 * set. On macOS, this checks that the passphrase is present in the user's
 * Keychain (where it is stored by the 'docker-chs-development' 'bin/init'
 * script and read by chs-dev before spawning docker compose). On other
 * platforms, the passphrase is not persisted anywhere - it is instead
 * requested interactively at the point of use - so this analysis is
 * skipped and always reports as passing.
 */
export default class SSHKeyPassphraseAnalysis extends BaseAnalysis {

    /**
     * Checks whether the SSH key passphrase Keychain item is set (macOS
     * only). Non-macOS platforms have nothing to persist and always pass.
     * @param {TroubleshootAnalysisTaskContext} _context - Troubleshoot analysis task context (unused)
     * @returns {Promise<AnalysisOutcome>} - Outcome indicating whether the passphrase is set
     */
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
