import { getCommitCountAheadOfRemote } from "../../../helpers/git.js";
import { getLatestReleaseVersion } from "../../../helpers/latest-release.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks docker-chs-development version";

const UPDATE_SUGGESTIONS = [
    "To reset local branch to remote and discard local changes.",
    "Run: git checkout master && git fetch origin && git reset --hard origin/master.",
    "To reset local branch to remote but keep local changes.",
    "Run: git checkout master && git fetch origin && git reset --soft origin/master.",
    "To fast-forward local branch to remote if local branch has no diverging changes.",
    "Run: git checkout master && git pull --ff-only origin master."
];

const DOCKER_CHS_DEVELOPMENT_LATEST_RELEASE_URL = "https://api.github.com/repos/companieshouse/docker-chs-development/releases/latest";

/**
 * An analysis task that evaluates whether the docker-chs-development local version is the latest.
 */
export default class DockerChsDevelopmentVersionAnalysis extends BaseAnalysis {

    async analyse ({ config: { projectPath } }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const issues = await this.isLocalBranchUpToDate(projectPath);

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, "Warn");
    }

    /**
     * Checks if the local branch is up to date with the remote branch.
     * It compares the number of commits ahead of the remote branch.
     * @param {string} projectPath - Path to the project repository
     * @returns { Promise<AnalysisIssue | undefined> } - Returns an issue if the local branch is behind, otherwise undefined
     */
    private async isLocalBranchUpToDate (projectPath: string): Promise<AnalysisIssue | undefined> {
        const latestVersion =
            await getLatestReleaseVersion(DOCKER_CHS_DEVELOPMENT_LATEST_RELEASE_URL);
        const commitDifference = await getCommitCountAheadOfRemote(projectPath);

        if (commitDifference > 0) {
            return this.createIssue(
                "docker-chs-development version is not up to date",
                `A newer version (${latestVersion}) is available. Update your local 'master' branch.`,
                UPDATE_SUGGESTIONS
            );
        }

        return undefined;
    }
}
