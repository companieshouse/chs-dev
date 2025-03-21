import { existsSync } from "fs";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks if SSH Keys are present in the local directory";

const SUGGESTIONS = [
    "Run: 'bin/init' command in the local project directory to initialise SSH keys."
];

const DOCUMENTATION_LINKS = [
    "troubleshooting-remedies/correctly-set-aws-environment-variables.md"
];

/**
 * An analysis task that evaluates whether the SSH Keys are created and stored in the project local directory.
 */
export default class SSHAnalysis extends BaseAnalysis {

    async analyse ({ config: { projectPath } }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const sshIssue = this.isSSHInitialised(projectPath);

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, sshIssue, "Fail");
    }

    /**
     * Checks if the SSH keys are initiated in the local project directory.
     * @param {string} projectPath - Path to the project repository
     * @returns { Promise<AnalysisIssue | undefined> } - Returns an issue if SSH Keys are missing , otherwise undefined
     */
    private isSSHInitialised (projectPath: string): AnalysisIssue | undefined {
        const fullpath = `${projectPath}/.ssh/initiated`;
        if (existsSync(fullpath)) {
            return undefined;
        }

        return this.createIssue(
            "SSH Keys not found",
            "SSH Keys are missing in the local project directory.",
            SUGGESTIONS

        );

    }
}
