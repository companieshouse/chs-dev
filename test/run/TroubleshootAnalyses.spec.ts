import { expect, jest } from "@jest/globals";
import TroubleshootAnalyses from "../../src/run/TroubleshootAnalyses";
import { modules, services } from "../utils/data";
import { Inventory } from "../../src/state/inventory";
import { StateManager } from "../../src/state/state-manager";
import AnalysisTask, { AnalysisFailureLevel } from "../../src/run/troubleshoot/analysis/AnalysisTask";
import { simpleColouriser as simpleColouriserMock } from "../../src/helpers/colouriser";
import fs from "fs";
import { isIbossEnabled } from "../../src/helpers/iboss-status.js";
import ProxiesConfiguredCorrectlyAnalysis from "../../src/run/troubleshoot/analysis/ProxiesConfiguredCorrectlyAnalysis.js";

const analysisTaskMockOne = {
    analyse: jest.fn()
};

const analysisTaskMockTwo = {
    analyse: jest.fn()
};

const analysisTaskMockThree = {
    analyse: jest.fn()
};

const analysisTasks: AnalysisTask[] = [
    analysisTaskMockOne as AnalysisTask,
    analysisTaskMockTwo as AnalysisTask,
    analysisTaskMockThree as AnalysisTask
];

const inventoryMock = {
    services,
    modules
} as Inventory;

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
} as StateManager;

const loggerMock = {
    log: jest.fn()
};

jest.mock("../../src/helpers/colouriser");

jest.mock("../../src/helpers/iboss-status.js", () => {
    return {
        isIbossEnabled: jest.fn()
    };
});

describe("TroubleshootAnalyses", () => {

    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    const config = {
        projectPath: "/home/user/docker",
        projectName: "docker",
        env: {}
    };

    const defaultMockBehaviour = () => {
        // @ts-expect-error
        simpleColouriserMock.mockImplementation((str: string, _) => str);

        analysisTaskMockOne.analyse.mockResolvedValue({
            headline: "Task one",
            level: AnalysisFailureLevel.WARN,
            issues: [],
            isSuccess: () => true
        } as never);

        analysisTaskMockTwo.analyse.mockResolvedValue({
            headline: "Task two",
            level: AnalysisFailureLevel.FAIL,
            issues: [],
            isSuccess: () => true
        } as never);

        analysisTaskMockThree.analyse.mockResolvedValue({
            headline: "Task three",
            level: AnalysisFailureLevel.INFO,
            issues: [],
            isSuccess: () => true
        } as never);

        writeFileSyncSpy.mockReturnValue(undefined);
    };

    describe("Default behaviour", () => {
        let troubleshootAnalyses: TroubleshootAnalyses;

        const emptyOptions = {};

        beforeEach(() => {
            jest.resetAllMocks();

            troubleshootAnalyses = new TroubleshootAnalyses(
                analysisTasks,
                inventoryMock,
                stateManagerMock,
                config,
                loggerMock
            );

            defaultMockBehaviour();
        });

        it("calls each task", async () => {
            await troubleshootAnalyses.perform(emptyOptions);

            expect(analysisTaskMockOne.analyse).toHaveBeenCalledWith({
                inventory: inventoryMock,
                config,
                stateManager: stateManagerMock
            });

            expect(analysisTaskMockTwo.analyse).toHaveBeenCalledWith({
                inventory: inventoryMock,
                config,
                stateManager: stateManagerMock
            });

            expect(analysisTaskMockThree.analyse).toHaveBeenCalledWith({
                inventory: inventoryMock,
                config,
                stateManager: stateManagerMock
            });
        });

        it("resolves to success outcome when successful", async () => {
            const result = await troubleshootAnalyses.perform(emptyOptions);

            expect(result.success).toBe(true);
        });

        it("resolves to be success outcome when all informational", async () => {
            analysisTaskMockOne.analyse.mockResolvedValue({
                level: AnalysisFailureLevel.INFO,
                issues: [{
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
                }],
                isSuccess: () => false
            } as never);

            const result = await troubleshootAnalyses.perform(emptyOptions);

            expect(result.success).toBe(true);

        });

        it("resolves to unsuccessful outcome when unsuccessful", async () => {
            analysisTaskMockOne.analyse.mockResolvedValue({
                level: AnalysisFailureLevel.WARN,
                issues: [{
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
                }],
                isSuccess: () => false
            } as never);

            const result = await troubleshootAnalyses.perform(emptyOptions);

            expect(result.success).toBe(false);
        });

        it("resolves to unsuccessful outcome when unsuccessful and one info", async () => {
            analysisTaskMockOne.analyse.mockResolvedValue({
                level: AnalysisFailureLevel.WARN,
                issues: [{
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
                }],
                isSuccess: () => false
            } as never);

            analysisTaskMockTwo.analyse.mockResolvedValue({
                level: AnalysisFailureLevel.INFO,
                issues: [{
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
                }],
                isSuccess: () => false
            } as never);

            const result = await troubleshootAnalyses.perform(emptyOptions);

            expect(result.success).toBe(false);
        });

        it("logs a successful message when there are no issues", async () => {
            await troubleshootAnalyses.perform(emptyOptions);

            expect(loggerMock.log).toHaveBeenCalledWith("SUCCESS! No issues found with your docker environment");
            expect(loggerMock.log).toHaveBeenCalledWith("If there are still problems with your environment create a report and seek support");
        });

        it("colourises success", async () => {
            await troubleshootAnalyses.perform(emptyOptions);

            expect(simpleColouriserMock).toHaveBeenCalledWith(
                "SUCCESS!", "bold-green"
            );

            expect(simpleColouriserMock).toHaveBeenCalledWith(
                "If there are still problems with your environment create a report and seek support",
                "grey"
            );
        });

        it("does not log successful messages when there are issues", async () => {
            analysisTaskMockOne.analyse.mockResolvedValue({
                level: AnalysisFailureLevel.WARN,
                issues: [{
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
                }],
                isSuccess: () => false
            } as never);

            await troubleshootAnalyses.perform(emptyOptions);

            expect(loggerMock.log).not.toHaveBeenCalledWith("SUCCESS! No issues found with your docker environment");
            expect(loggerMock.log).not.toHaveBeenCalledWith("If there are still problems with your environment create a report and seek support");
        });

        it("logs an error when there are issues", async () => {

            analysisTaskMockOne.analyse.mockResolvedValue({
                level: AnalysisFailureLevel.WARN,
                issues: [{
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

                }],
                isSuccess: () => false
            } as never);

            await troubleshootAnalyses.perform(emptyOptions);

            expect(loggerMock.log).toHaveBeenCalledWith(
                "There were issues found with your environment"
            );
        });

        it("logs the outcome of failed tasks correctly", async () => {
            analysisTaskMockOne.analyse.mockResolvedValue({
                headline: "Check for services in development mode correctly configured",
                level: AnalysisFailureLevel.WARN,
                issues: [{
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

                }, {
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
                }],
                isSuccess: () => false
            } as never);

            analysisTaskMockTwo.analyse.mockResolvedValue({
                headline: "Incorrect something else",
                level: AnalysisFailureLevel.FAIL,
                issues: [{
                    title: "Something seriously incorrect with your setup",
                    description: "Description about what is seriously wrong",
                    suggestions: [
                        "Provide a valid value for this or that"
                    ],
                    documentationLinks: [
                        "troubleshooting-remedies/correctly-do-the-right-thing.md"
                    ]

                }],
                isSuccess: () => false
            } as never);

            await troubleshootAnalyses.perform(emptyOptions);

            expect(loggerMock.log.mock.calls).toMatchSnapshot();
        });

        it("colours the outcome of failed tasks correctly", async () => {
            analysisTaskMockOne.analyse.mockResolvedValue({
                headline: "Check for services in development mode correctly configured",
                level: AnalysisFailureLevel.WARN,
                issues: [{
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

                }, {
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
                }],
                isSuccess: () => false
            } as never);

            analysisTaskMockTwo.analyse.mockResolvedValue({
                headline: "Incorrect something else",
                level: AnalysisFailureLevel.FAIL,
                issues: [{
                    title: "Something seriously incorrect with your setup",
                    description: "Description about what is seriously wrong",
                    suggestions: [
                        "Provide a valid value for this or that"
                    ],
                    documentationLinks: [
                        "troubleshooting-remedies/correctly-do-the-right-thing.md"
                    ]

                }],
                isSuccess: () => false
            } as never);

            analysisTaskMockThree.analyse.mockResolvedValue({
                headline: "Info about something else that worth looking at",
                level: AnalysisFailureLevel.INFO,
                issues: [{
                    title: "Something could be incorrect with your setup",
                    description: "Description about what is could be wrong",
                    suggestions: [
                        "Provide a valid value for this or that"
                    ],
                    documentationLinks: [
                        "troubleshooting-remedies/correctly-do-the-right-thing.md"
                    ]

                }],
                isSuccess: () => false
            } as never);

            await troubleshootAnalyses.perform(emptyOptions);

            expect(simpleColouriserMock).toHaveBeenCalledWith(
                "CRITICAL", "bold-red"
            );

            expect(simpleColouriserMock).toHaveBeenCalledWith(
                "WARNING", "yellow"
            );

            expect(simpleColouriserMock).toHaveBeenCalledWith(
                "QUERY", "cyan"
            );
        });
    });

    describe("quiet", () => {

        let troubleshootAnalyses: TroubleshootAnalyses;

        const quietOptions = {
            quiet: true
        };

        beforeEach(() => {
            jest.resetAllMocks();

            troubleshootAnalyses = new TroubleshootAnalyses(
                analysisTasks,
                inventoryMock,
                stateManagerMock,
                config,
                loggerMock
            );

            defaultMockBehaviour();
        });

        it("does not log when there are no issues", async () => {
            await troubleshootAnalyses.perform(quietOptions);

            expect(loggerMock.log).not.toHaveBeenCalled();
        });

        it("does not log when there are are issues", async () => {
            analysisTaskMockOne.analyse.mockResolvedValue({
                headline: "Check for services in development mode correctly configured",
                level: AnalysisFailureLevel.WARN,
                issues: [{
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

                }, {
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
                }],
                isSuccess: () => false
            } as never);

            analysisTaskMockTwo.analyse.mockResolvedValue({
                headline: "Incorrect something else",
                level: AnalysisFailureLevel.FAIL,
                issues: [{
                    title: "Something seriously incorrect with your setup",
                    description: "Description about what is seriously wrong",
                    suggestions: [
                        "Provide a valid value for this or that"
                    ],
                    documentationLinks: [
                        "troubleshooting-remedies/correctly-do-the-right-thing.md"
                    ]

                }],
                isSuccess: () => false
            } as never);

            await troubleshootAnalyses.perform(quietOptions);

            expect(loggerMock.log).not.toHaveBeenCalled();
        });
    });

    describe("fileOut", () => {

        let troubleshootAnalyses: TroubleshootAnalyses;

        const fileOutOptions = {
            fileOut: "/home/user/analyses.json"
        };

        beforeEach(() => {
            jest.resetAllMocks();

            troubleshootAnalyses = new TroubleshootAnalyses(
                analysisTasks,
                inventoryMock,
                stateManagerMock,
                config,
                loggerMock
            );

            defaultMockBehaviour();
        });

        it("outputs empty analyses with empty issues when no issues", async () => {
            analysisTaskMockTwo.analyse.mockResolvedValue({
                headline: "Check for services in development mode correctly configured",
                level: AnalysisFailureLevel.FAIL,
                issues: [{
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

                }, {
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
                }],
                isSuccess: () => false
            } as never);

            await troubleshootAnalyses.perform(fileOutOptions);

            expect(writeFileSyncSpy).toHaveBeenCalledWith(
                fileOutOptions.fileOut,
                JSON.stringify({
                    analysisResults: {
                        "Task one": {
                            criticality: "WARNING",
                            issues: []
                        },
                        "Check for services in development mode correctly configured": {
                            criticality: "CRITICAL",
                            issues: [{
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

                            }, {
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
                            }]
                        },
                        "Task three": {
                            criticality: "QUERY",
                            issues: []
                        }
                    }
                })
            );

        });

        it("The ProxiesConfiguredCorrectlyAnalysis task to be filtered out when iboss is enabled", async () => {
            (isIbossEnabled as jest.Mock).mockReturnValue(true);
            const analysisTaskMockFour = new ProxiesConfiguredCorrectlyAnalysis();

            const task = [...analysisTasks, analysisTaskMockFour];

            // eslint-disable-next-line dot-notation
            const filteredTasks = troubleshootAnalyses["handleIbossCheck"](task);

            expect(filteredTasks).not.toContain(analysisTaskMockFour);

        });

        it("The ProxiesConfiguredCorrectlyAnalysis task to be a task when iboss is disabled", async () => {
            (isIbossEnabled as jest.Mock).mockReturnValue(false);
            const analysisTaskMockFour = new ProxiesConfiguredCorrectlyAnalysis();
            const task = [...analysisTasks, analysisTaskMockFour];

            // eslint-disable-next-line dot-notation
            const filteredTasks = troubleshootAnalyses["handleIbossCheck"](task);

            expect(filteredTasks).toContain(analysisTaskMockFour);

        });

        it("can be combined with quiet", async () => {
            await troubleshootAnalyses.perform({ ...fileOutOptions, quiet: true });

            expect(writeFileSyncSpy).toHaveBeenCalledWith(
                fileOutOptions.fileOut,
                expect.anything()
            );

            expect(loggerMock.log).not.toHaveBeenCalled();
        });
    });
});
