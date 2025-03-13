import { expect, jest } from "@jest/globals";
import childProcess from "child_process";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import AwsEnvironmentVariableAnalysis from "../../../../src/run/troubleshoot/analysis/AwsEnvironmentVariableAnalysis";

describe("AwsEnvironmentVariableAnalysis", () => {
    let analysis: AwsEnvironmentVariableAnalysis;
    const execSyncMock = jest.spyOn(childProcess, "execSync");
    const mockAwsListProfiles = `development-eu-west-1\ndevelopment-eu-west-2\nshared-services-ecr-eu-west-1-ro\nshared-services-ecr-eu-west-2-ro\nDevelopment-169942020521\n`;
    const SUGGESTIONS = [
        "Run the below command to set the AWS profile:",
        "`export AWS_PROFILE=development-eu-west-2`"
    ];
    const DOCUMENTATION_LINKS = [
        "troubleshooting-remedies/correctly-set-aws-environment-variables.md"
    ];

    beforeEach(async () => {
        analysis = new AwsEnvironmentVariableAnalysis();
        delete process.env.AWS_PROFILE;
        jest.resetAllMocks();

    });

    it("should not return an issue if the AWS_PROFILE variable is configured correctly", async () => {
        const analysisContext = {
            inventory: {},
            stateManager: {}
        } as TroubleshootAnalysisTaskContext;
        process.env.AWS_PROFILE = "development-eu-west-2";

        (execSyncMock as jest.Mock).mockImplementationOnce(() =>
            mockAwsListProfiles
        );

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

    it("should return an issue if the AWS_PROFILE variable is incorrect", async () => {
        const analysisContext = {
            inventory: {},
            stateManager: {}
        } as TroubleshootAnalysisTaskContext;
        process.env.AWS_PROFILE = "unset";

        (execSyncMock as jest.Mock).mockImplementationOnce(() =>
            mockAwsListProfiles
        );

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues).toEqual([
            {
                title: "AWS_PROFILE environment variable was overwritten or not set",
                description: "Ensure 'AWS_PROFILE' environment variable is set to one of the following profiles: " + mockAwsListProfiles.split("\n").filter(Boolean).join(", "),
                suggestions: SUGGESTIONS,
                documentationLinks: DOCUMENTATION_LINKS
            }
        ]);
    });
});
