import { expect, jest } from "@jest/globals";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import EcrLoginAnalysis from "../../../../src/run/troubleshoot/analysis/ECRLoginAnalysis";
import * as fs from "fs";
import { timeWithinThreshold, ThresholdUnit } from "../../../../src/helpers/time-within-threshold";

jest.mock("fs");

jest.mock("../../../../src/helpers/time-within-threshold", () => ({
    timeWithinThreshold: jest.fn(),
    ThresholdUnit: {
        MINUTES: 1000 * 60,
        HOURS: 1000 * 60 * 60,
        DAYS: 1000 * 60 * 60 * 24
    }
}));

describe("ECRLoginAnalysis", () => {
    let analysis: EcrLoginAnalysis;

    beforeEach(async () => {
        analysis = new EcrLoginAnalysis();
        jest.resetAllMocks();

    });

    it("should return an issue if the DataDir property is not set", async () => {

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
                title: "ECR Login Status Check Failed",
                description: "Unable to perform check. DataDir path is missing from configuration.",
                suggestions: [],
                documentationLinks: []
            }
        ]);
    });

    it("should return an issue if the lastRunTimeFile doesnt exist or threshold has been exceeded  ", async () => {

        const analysisContext = {
            inventory: {},
            stateManager: {},
            config: {
                projectPath: "/home/user/docker",
                projectName: "docker",
                performEcrLoginHoursThreshold: 7,
                chsDevDataDir: "/mock/path/data.dir",
                env: {}
            }
        } as TroubleshootAnalysisTaskContext;

        (fs.existsSync as jest.Mock).mockReturnValue(false); // lastRunTimeFile doesnt exist

        (timeWithinThreshold as jest.Mock).mockReturnValue(false); // threshold is exceeded

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "User Not Logged into ECR",
                description: "The login logs indicate that the user is either not logged in or the login session has expired.",
                suggestions: [],
                documentationLinks: []
            }
        ]);
    });

    it("should not return an issue if the lastRunTimeFile exist and threshold is not exceeded  ", async () => {

        const analysisContext = {
            inventory: {},
            stateManager: {},
            config: {
                projectPath: "/home/user/docker",
                projectName: "docker",
                performEcrLoginHoursThreshold: 7,
                chsDevDataDir: "/mock/path/data.dir",
                env: {}
            }
        } as TroubleshootAnalysisTaskContext;

        (fs.existsSync as jest.Mock).mockReturnValue(true); // lastRunTimeFile exist

        (timeWithinThreshold as jest.Mock).mockReturnValue(true); // threshold is not exceeded

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

});
