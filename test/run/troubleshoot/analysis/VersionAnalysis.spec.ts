import { expect, jest } from "@jest/globals";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import VersionAnalysis from "../../../../src/run/troubleshoot/analysis/VersionAnalysis";
import { diff, satisfies } from "semver";

jest.mock("semver", () => ({
    satisfies: jest.fn(),
    diff: jest.fn()
}));

describe("VersionAnalysis", () => {
    let analysis: VersionAnalysis;
    const VERSION_SUGGESTIONS = [
        "Run: 'chs-dev sync --latest' to update chs-dev to a suitable version. Refer to the documentation for guidance."
    ];

    beforeEach(async () => {
        analysis = new VersionAnalysis();
        jest.resetAllMocks();

    });

    it("should return an issue if the version properties are not set", async () => {

        const analysisContext = {
            inventory: {},
            stateManager: {},
            config: {
                projectPath: "/home/user/docker",
                projectName: "docker",
                performEcrLoginHoursThreshold: 2,
                env: {}
            }
        } as TroubleshootAnalysisTaskContext;

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "chs-dev version check failed",
                description: "Unable to perform check. The version property is missing from configuration.",
                suggestions: [],
                documentationLinks: []
            }
        ]);
    });

    it("should return an issue if app version is not the latest ", async () => {

        const analysisContext = {
            inventory: {},
            stateManager: {},
            config: {
                projectPath: "/home/user/docker",
                projectName: "docker",
                performEcrLoginHoursThreshold: 7,
                versionSpecification: ">=3.0.0 <4.0.0",
                chsDevVersion: "2.0.0",
                env: {}
            }
        } as TroubleshootAnalysisTaskContext;

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
    });

    it("should return an issue if app version does not meet the project requirements ", async () => {

        const analysisContext = {
            inventory: {},
            stateManager: {},
            config: {
                projectPath: "/home/user/docker",
                projectName: "docker",
                performEcrLoginHoursThreshold: 7,
                versionSpecification: ">=3.0.0 <4.0.0",
                chsDevVersion: "2.0.0",
                env: {}
            }
        } as TroubleshootAnalysisTaskContext;
        (satisfies as jest.Mock).mockReturnValue(false);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues[0]).toEqual(
            {
                title: "chs-dev version does not meet the project requirements",
                description: `The current application version is ${analysisContext.config.chsDevVersion}, but the required version is ${analysisContext.config.versionSpecification}. Upgrade your chs-dev version.`,
                suggestions: VERSION_SUGGESTIONS,
                documentationLinks: ["troubleshooting-remedies/correctly-upgrade-chs-dev-version.md"]
            }
        );
    });

});
