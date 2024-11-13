import { expect, jest } from "@jest/globals";
import { modules, services } from "../../../utils/data";
import { getBuilders as getBuildersMock } from "../../../../src/state/builders";
import { generateBuilderSpec } from "../../../utils/docker-compose-spec";
import ServicesInLiveUpdateConfiguredCorrectlyAnalysis from "../../../../src/run/troubleshoot/analysis/ServicesInLiveUpdateConfiguredCorrectlyAnalysis";
import fs from "fs";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import { join } from "path";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import "../utils/outcome-expectation-extension";

const inventoryMock = {
    services,
    modules
};

const stateManagerMock = {
    snapshot: {
        modules: [
            "module-one"
        ],
        services: [
            "service-six"
        ],
        servicesWithLiveUpdate: [
            "service-two",
            "service-ten",
            "service-nine"
        ],
        excludedServices: [
            "service-four"
        ]
    }
};

jest.mock("../../../../src/helpers/user-input");
jest.mock("../../../../src/state/builders");

describe("ServicesInLiveUpdateConfiguredCorrectlyAnalysis", () => {

    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    let servicesInLiveUpdateConfiguredCorrectlyAnalysis: ServicesInLiveUpdateConfiguredCorrectlyAnalysis;

    const analysisContext = {
        inventory: inventoryMock,
        stateManager: stateManagerMock,
        config: {
            projectPath: "/home/user/docker",
            projectName: "docker",
            env: {}
        }
    } as TroubleshootAnalysisTaskContext;

    beforeEach(() => {
        jest.resetAllMocks();

        existsSyncSpy.mockResolvedValue(true as never);

        servicesInLiveUpdateConfiguredCorrectlyAnalysis = new ServicesInLiveUpdateConfiguredCorrectlyAnalysis();
        // @ts-expect-error
        getBuildersMock.mockReturnValue({
            java: {
                v1: {
                    name: "java",
                    version: "v1",
                    builderSpec: generateBuilderSpec("local/builders/java/v1")
                }
            },
            "java-11": {
                v1: {
                    name: "java-11",
                    version: "v1",
                    builderSpec: generateBuilderSpec("local/builders/java-11/v1")
                }
            },
            node: {
                v1: {
                    name: "node",
                    version: "v1",
                    builderSpec: generateBuilderSpec("local/builders/node/v1")
                }
            }
        });

    });

    it("Checks for Dockerfile when no builder label", async () => {
        await servicesInLiveUpdateConfiguredCorrectlyAnalysis.analyse(analysisContext);

        expect(existsSyncSpy).toHaveBeenCalledWith(join(analysisContext.config.projectPath, "repositories/service-ten/Dockerfile"));
    });

    it("Returns successful result when no issues", async () => {
        const result = await servicesInLiveUpdateConfiguredCorrectlyAnalysis.analyse(analysisContext);

        expect(result.isSuccess()).toBe(true);
    });

    it("Returns unsuccessful result when the repo without label", async () => {
        existsSyncSpy.mockReturnValue(false);

        const result = await servicesInLiveUpdateConfiguredCorrectlyAnalysis.analyse(analysisContext);

        expect(result.isSuccess()).toBe(false);
    });

    it("Returns expected issue when service without label", async () => {
        existsSyncSpy.mockReturnValue(false);

        const result = await servicesInLiveUpdateConfiguredCorrectlyAnalysis.analyse(analysisContext);

        const expectedIssue = {
            title: "Missing Dockerfile for service in Development mode without builder label",
            description: "Missing Dockerfile for service service-ten",
            suggestions: [
                "Provide a valid value for the builder label",
                "Create a Dockerfile"
            ],
            documentationLinks: [
                "troubleshooting-remedies/correctly-setup-repository-builder.md",
                "troubleshooting-remedies/correctly-setup-builder.md"
            ]
        };

        expect(result).outcomeIncludesIssue(expectedIssue);
    });

    it("Returns false when builder label supplied but does not exist", async () => {
        // @ts-expect-error
        getBuildersMock.mockReturnValue({
            java: {
                v1: {
                    name: "java",
                    version: "v1",
                    builderSpec: generateBuilderSpec("local/builders/java/v1")
                }
            },
            node: {
                v1: {
                    name: "node",
                    version: "v1",
                    builderSpec: generateBuilderSpec("local/builders/node/v1")
                }
            }
        });

        const result = await servicesInLiveUpdateConfiguredCorrectlyAnalysis.analyse(analysisContext);

        expect(result.isSuccess()).toBe(false);
    });

    it("Returns expected issue when builder label supplied but does not exist", async () => {
        // @ts-expect-error
        getBuildersMock.mockReturnValue({
            java: {
                v1: {
                    name: "java",
                    version: "v1",
                    builderSpec: generateBuilderSpec("local/builders/java/v1")
                }
            },
            node: {
                v1: {
                    name: "node",
                    version: "v1",
                    builderSpec: generateBuilderSpec("local/builders/node/v1")
                }
            }
        });

        const result = await servicesInLiveUpdateConfiguredCorrectlyAnalysis.analyse(analysisContext);

        const expectedIssue = {
            title: "Incorrect Builder defined for service in development mode",
            description: "Service: service-nine contains an incorrect builder label: java-11",
            suggestions: [
                "Provide a valid value for the builder label from: java, node",
                "Remove the builder label and Produce a Dockerfile in the source"
            ],
            documentationLinks: [
                "troubleshooting-remedies/correctly-setup-repository-builder.md",
                "troubleshooting-remedies/correctly-setup-builder.md"
            ]
        };

        expect(result).outcomeIncludesIssue(expectedIssue);
    });

    // it("Returns true when builder is correct", async () => {
    //     await expect(checkForServicesInLiveUpdateConfigured.autoTask(actionContext)).resolves.toBe(true);
    // });

    // it("Returns false when builder does not exist", async () => {
    //     existsSyncSpy.mockReturnValue(false as never);

    //     await expect(checkForServicesInLiveUpdateConfigured.autoTask(actionContext)).resolves.toBe(false);
    // });

});
