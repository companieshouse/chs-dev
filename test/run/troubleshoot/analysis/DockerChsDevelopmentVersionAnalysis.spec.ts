import { expect, jest } from "@jest/globals";
import { getCommitCountAheadOfRemote } from "../../../../src/helpers/git";
import { getLatestReleaseVersion } from "../../../../src/helpers/latest-release";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import DockerChsDevelopmentVersionAnalysis from "../../../../src/run/troubleshoot/analysis/DockerChsDevelopmentVersionAnalysis";

jest.mock("../../../../src/helpers/latest-release", () => ({
    getLatestReleaseVersion: jest.fn()
}));

jest.mock("../../../../src/helpers/git", () => ({
    getCommitCountAheadOfRemote: jest.fn()
}));

describe("VersionAnalysis", () => {
    let analysis: DockerChsDevelopmentVersionAnalysis;

    const VERSION_SUGGESTIONS = [
        "Run: git checkout master && git fetch origin && git reset --hard origin/master.",
        "Note: All local changes will be discarded. Stash or commit changes before command execution."
    ];

    beforeEach(async () => {
        analysis = new DockerChsDevelopmentVersionAnalysis();
        jest.resetAllMocks();

    });

    it("should return an issue if the local version is not the latest", async () => {

        const analysisContext = {
            config: {
                projectPath: "/home/user/docker"
            }
        } as TroubleshootAnalysisTaskContext;

        (getLatestReleaseVersion as jest.Mock).mockReturnValue("2.0.140");
        (getCommitCountAheadOfRemote as jest.Mock).mockReturnValue(1);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "docker-chs-development version is not up to date",
                description: `A newer version (2.0.140) is available. Update your local 'master' branch.`,
                suggestions: VERSION_SUGGESTIONS,
                documentationLinks: []
            }
        ]);
    });

    it("should not return an issue if local branch has the latest remote commit", async () => {

        const analysisContext = {
            config: {
                projectPath: "/home/user/docker"
            }
        } as TroubleshootAnalysisTaskContext;

        (getLatestReleaseVersion as jest.Mock).mockReturnValue("2.0.140");
        (getCommitCountAheadOfRemote as jest.Mock).mockReturnValue(0);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

});
