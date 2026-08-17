import { getItemFromKeyChain } from "../../../helpers/keychain.js";
import CONSTANTS from "../../../model/Constants.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks SSH Key passphrase is set correctly";

const NOT_SET_SUGGESTIONS = [
    "Run: 'bin/init' command in the 'docker-chs-development' project directory to set the SSH key passphrase."
];

const UNSET_VALUE_SUGGESTIONS = [
    "Regenerate the SSH key using 'dev-env-setup' and set a passphrase for it.",
    "Run: 'bin/init' command in the 'docker-chs-development' project directory to set the SSH key passphrase."
];

/**
 * An analysis task that evaluates whether the SSH Key passphrase is set and configured correctly.
 */
export default class SSHKeyPassphraseAnalysis extends BaseAnalysis {

    async analyse (_context: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const passphraseIssue = await this.checkSSHKeyPassphrase();

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, passphraseIssue, "Fail");
    }

    /**
     * Checks the SSH key passphrase value stored in the keychain.
     * Ensures the value is set and is not the unset placeholder value.
     * @returns { Promise<AnalysisIssue | undefined> } - Returns an issue if the value is unset or is the placeholder value, otherwise undefined
     */
    private async checkSSHKeyPassphrase (): Promise<AnalysisIssue | undefined> {
        const sshKeyPassphrase = await getItemFromKeyChain(CONSTANTS.SSH_PASSWORD_KEYCHAIN_ITEM_NAME);

        if (!sshKeyPassphrase) {
            return this.createIssue(
                "SSH Key passphrase not set",
                "SSH Key passphrase is not set. Rerun the init script for 'docker-chs-development' to set the SSH key passphrase.",
                NOT_SET_SUGGESTIONS
            );
        }

        if (sshKeyPassphrase === CONSTANTS.NO_SSH_PASSWORD_VALUE) {
            return this.createIssue(
                "SSH Key passphrase not configured correctly",
                "SSH Key passphrase has not been set for the SSH key. Regenerate the SSH key and set a passphrase for it, then rerun the init script for 'docker-chs-development'.",
                UNSET_VALUE_SUGGESTIONS
            );
        }

        return undefined;
    }
}
