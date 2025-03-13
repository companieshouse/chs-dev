import { expect, jest } from "@jest/globals";
import childProcess from "child_process";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import AwsEnvironmentVariableAnalysis from "../../../../src/run/troubleshoot/analysis/AwsEnvironmentVariableAnalysis";

describe("AwsEnvironmentVariableAnalysis", () => {
    let analysis: AwsEnvironmentVariableAnalysis;
    const execSyncMock = jest.spyOn(childProcess, "execSync");
    const mockAwsListProfiles = `development-eu-west-1\ndevelopment-eu-west-2\nshared-services-ecr-eu-west-1-ro\nshared-services-ecr-eu-west-2-ro\nDevelopment-169942020521\n`;
    const mockAwsGetRegionResult = `us-east-1\n`;
    const SUGGESTIONS = [
        "Run the below command to set the AWS profile or AWS region:",
        "`export AWS_PROFILE=development-eu-west-2` or `export _AWS_REGION=eu-west-2`"
    ];
    const DOCUMENTATION_LINKS = [
        "troubleshooting-remedies/correctly-set-aws-environment-variables.md"
    ];

    beforeEach(async () => {
        analysis = new AwsEnvironmentVariableAnalysis();
        jest.resetAllMocks();

    });

    describe("Check the AWS_PROFILE environment variables", () => {
        beforeEach(() => {
            process.env._AWS_REGION = "us-east-1";
            process.env._DEFAULT_AWS_REGION = "us-east-1";

            delete process.env.AWS_PROFILE;
            process.env._AWS_PROFILE = "us-east-1";
            process.env._DEFAULT_AWS_PROFILE = "us-east-1";
        });

        afterEach(() => {
            delete process.env._AWS_REGION;
            delete process.env._DEFAULT_AWS_REGION;

            delete process.env._AWS_PROFILE;
            delete process.env._DEFAULT_AWS_PROFILE;
        });
        it("should return an issue if the AWS_PROFILE variables are invalid or not set", async () => {
            const analysisContext = {
                inventory: {},
                stateManager: {}
            } as TroubleshootAnalysisTaskContext;

            (execSyncMock as jest.Mock).mockImplementationOnce(() =>
                mockAwsListProfiles
            );
            (execSyncMock as jest.Mock).mockImplementationOnce(() => mockAwsGetRegionResult);

            const outcome = await analysis.analyse(analysisContext);

            expect(outcome).toBeInstanceOf(AnalysisOutcome);
            expect(outcome.isSuccess()).toBe(false);
            expect(outcome.issues).toEqual([
                {
                    title: "AWS_PROFILE environment variables are invalid or not set",
                    description: "Ensure the 'AWS_PROFILE', '_AWS_PROFILE', '_DEFAULT_AWS_PROFILE' environment variables are set to one of the following profiles: " + mockAwsListProfiles.split("\n").filter(Boolean).join(", "),
                    suggestions: SUGGESTIONS,
                    documentationLinks: DOCUMENTATION_LINKS
                }
            ]);
        });
    });

    describe("Check the AWS_REGION environment variables", () => {
        beforeEach(() => {
            process.env.AWS_PROFILE = "development-eu-west-2";
            process.env._AWS_PROFILE = "development-eu-west-2";
            process.env._DEFAULT_AWS_PROFILE = "development-eu-west-2";

            delete process.env._AWS_REGION;
            process.env._DEFAULT_AWS_REGION = "development-eu-west-2";
        });

        afterEach(() => {
            delete process.env.AWS_PROFILE;
            delete process.env._AWS_PROFILE;
            delete process.env._DEFAULT_AWS_PROFILE;
            delete process.env._DEFAULT_AWS_REGION;
        });
        it("should return an issue if the AWS_REGION variables are invalid or not set", async () => {
            const analysisContext = {
                inventory: {},
                stateManager: {}
            } as TroubleshootAnalysisTaskContext;

            (execSyncMock as jest.Mock).mockImplementationOnce(() =>
                mockAwsListProfiles
            );

            (execSyncMock as jest.Mock).mockImplementationOnce(() =>
                mockAwsGetRegionResult
            );

            const outcome = await analysis.analyse(analysisContext);

            expect(outcome).toBeInstanceOf(AnalysisOutcome);
            expect(outcome.isSuccess()).toBe(false);
            expect(outcome.issues).toEqual([
                {
                    title: "AWS_REGION environment variables are invalid or not set",
                    description: "Ensure the '_AWS_REGION', '_DEFAULT_AWS_REGION' environment variables are set to region: " + mockAwsGetRegionResult.trim(),
                    suggestions: SUGGESTIONS,
                    documentationLinks: DOCUMENTATION_LINKS
                }
            ]);
        });
    });

    describe("AWS_PROFILE and AWS_REGION environment variables are valid", () => {
        beforeEach(() => {
            process.env.AWS_PROFILE = "development-eu-west-2";
            process.env._AWS_PROFILE = "development-eu-west-2";
            process.env._DEFAULT_AWS_PROFILE = "development-eu-west-2";

            process.env._AWS_REGION = "us-east-1";
            process.env._DEFAULT_AWS_REGION = "us-east-1";
        });

        afterEach(() => {
            delete process.env.AWS_PROFILE;
            delete process.env._AWS_PROFILE;
            delete process.env._DEFAULT_AWS_PROFILE;
            delete process.env._AWS_REGION;
            delete process.env._DEFAULT_AWS_REGION;
        });
        it("should not return an issue if the  AWS_PROFILE and AWS_REGION variables are valid", async () => {
            const analysisContext = {
                inventory: {},
                stateManager: {}
            } as TroubleshootAnalysisTaskContext;

            (execSyncMock as jest.Mock).mockImplementationOnce(() =>
                mockAwsListProfiles
            );

            (execSyncMock as jest.Mock).mockImplementationOnce(() =>
                mockAwsGetRegionResult
            );

            const outcome = await analysis.analyse(analysisContext);

            expect(outcome).toBeInstanceOf(AnalysisOutcome);
            expect(outcome.isSuccess()).toBe(true);
        });
    });
});
