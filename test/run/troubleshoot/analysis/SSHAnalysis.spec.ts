import { expect, jest } from "@jest/globals";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import * as fs from "fs";
import SSHAnalysis from "../../../../src/run/troubleshoot/analysis/SSHAnalysis";

jest.mock("fs");

describe("SSHAnalysis", () => {
    let analysis: SSHAnalysis;
    const SUGGESTIONS = [
        "Run: 'bin/init' command in the local project directory to initialise SSH keys."
    ];

    beforeEach(async () => {
        analysis = new SSHAnalysis();
        jest.resetAllMocks();

    });

    it("should return an issue if ssh keys are missing", async () => {

        const analysisContext = {
            inventory: {},
            stateManager: {},
            config: {
                projectPath: "/home/user/docker",
                projectName: "docker"
            }
        } as TroubleshootAnalysisTaskContext;

        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "SSH Keys not found",
                description: "SSH Keys are missing in the local project directory.",
                suggestions: SUGGESTIONS,
                documentationLinks: []
            }
        ]);
    });

    it("should not return an issue if ssh keys are present", async () => {

        const analysisContext = {
            inventory: {},
            stateManager: {},
            config: {
                projectPath: "/home/user/docker",
                projectName: "docker"
            }
        } as TroubleshootAnalysisTaskContext;

        (fs.existsSync as jest.Mock).mockReturnValue(true);

        const outcome = await analysis.analyse(analysisContext);
        expect(outcome.isSuccess()).toBe(true);
    });

});
