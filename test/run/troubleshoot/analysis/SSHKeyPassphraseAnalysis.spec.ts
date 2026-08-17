import { expect, jest } from "@jest/globals";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import CONSTANTS from "../../../../src/model/Constants";
import * as keychain from "../../../../src/helpers/keychain";
import SSHKeyPassphraseAnalysis from "../../../../src/run/troubleshoot/analysis/SSHKeyPassphraseAnalysis";

jest.mock("../../../../src/helpers/keychain");

describe("SSHKeyPassphraseAnalysis", () => {
    let analysis: SSHKeyPassphraseAnalysis;
    const getItemFromKeyChainMock = keychain.getItemFromKeyChain as jest.MockedFunction<typeof keychain.getItemFromKeyChain>;

    const analysisContext = {
        inventory: {},
        stateManager: {},
        config: {
            projectPath: "/home/user/docker",
            projectName: "docker"
        }
    } as TroubleshootAnalysisTaskContext;

    beforeEach(async () => {
        analysis = new SSHKeyPassphraseAnalysis();
        jest.resetAllMocks();
    });

    it("should return an issue if the SSH key passphrase is not set", async () => {
        getItemFromKeyChainMock.mockResolvedValueOnce(undefined);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "SSH Key passphrase not set",
                description: "SSH Key passphrase is not set. Rerun the init script for 'docker-chs-development' to set the SSH key passphrase.",
                suggestions: [
                    "Run: 'bin/init' command in the 'docker-chs-development' project directory to set the SSH key passphrase."
                ],
                documentationLinks: []
            }
        ]);
    });

    it("should return an issue if the SSH key passphrase is the unset placeholder value", async () => {
        getItemFromKeyChainMock.mockResolvedValueOnce(CONSTANTS.NO_SSH_PASSWORD_VALUE);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "SSH Key passphrase not configured correctly",
                description: "SSH Key passphrase has not been set for the SSH key. Regenerate the SSH key and set a passphrase for it, then rerun the init script for 'docker-chs-development'.",
                suggestions: [
                    "Regenerate the SSH key using 'dev-env-setup' and set a passphrase for it.",
                    "Run: 'bin/init' command in the 'docker-chs-development' project directory to set the SSH key passphrase."
                ],
                documentationLinks: []
            }
        ]);
    });

    it("should not return an issue if the SSH key passphrase is set correctly", async () => {
        getItemFromKeyChainMock.mockResolvedValueOnce("some-secure-passphrase");

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
        expect(outcome.issues).toEqual([]);
    });
});
