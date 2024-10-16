import { jest, expect } from "@jest/globals";
import { services, modules } from "../../../utils/data";
import fs from "fs";
import { CheckForServicesInLiveUpdateConfigured } from "../../../../src/run/troubleshoot/action/check-for-services-in-live-update-configured";
import { TroubleshootActionContext } from "../../../../src/run/troubleshoot/action/TroubleshootAction";
import { join } from "path";
import { confirm as confirmMock } from "../../../../src/helpers/user-input";
import { StateManager } from "../../../../src/state/state-manager";
import { provideLinkToDocumentaton as provideLinkToDocumentatonMock } from "../../../../src/run/troubleshoot/action/documentation-prompt";
import { getBuilders as getBuildersMock } from "../../../../src/state/builders";
import { generateBuilderSpec } from "../../../utils/docker-compose-spec";

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
            "service-ten"
        ],
        excludedServices: [
            "service-four"
        ]
    }
};

jest.mock("../../../../src/helpers/user-input");
jest.mock("../../../../src/state/builders");
jest.mock("../../../../src/run/troubleshoot/action/documentation-prompt");

describe("checkForServicesInLiveUpdateConfigured", () => {
    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    const actionContext = {
        inventory: inventoryMock,
        stateManager: stateManagerMock,
        config: {
            projectPath: "/home/user/docker",
            projectName: "docker",
            env: {}
        }
    } as TroubleshootActionContext;

    let checkForServicesInLiveUpdateConfigured: CheckForServicesInLiveUpdateConfigured;

    beforeEach(() => {
        jest.resetAllMocks();

        existsSyncSpy.mockResolvedValue(true as never);

        checkForServicesInLiveUpdateConfigured = new CheckForServicesInLiveUpdateConfigured();

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

    it("autoTask checks for Dockerfile when no builder label", async () => {

        await checkForServicesInLiveUpdateConfigured.autoTask(actionContext);

        expect(existsSyncSpy).toHaveBeenCalledWith(join(actionContext.config.projectPath, "repositories/service-ten/Dockerfile"));
    });

    it("autoTask checks whether the builder exists for the named builder", async () => {
        await checkForServicesInLiveUpdateConfigured.autoTask(actionContext);

        expect(existsSyncSpy).toHaveBeenCalledWith(join(actionContext.config.projectPath, "local/builders/node"));
    });

    it("autoTask returns true when builder is correct", async () => {
        await expect(checkForServicesInLiveUpdateConfigured.autoTask(actionContext)).resolves.toBe(true);
    });

    it("autoTask returns false when builder does not exist", async () => {
        existsSyncSpy.mockReturnValue(false as never);

        await expect(checkForServicesInLiveUpdateConfigured.autoTask(actionContext)).resolves.toBe(false);
    });

    it("autoTask returns false when one does not exist", async () => {
        existsSyncSpy.mockReturnValueOnce(true as never).mockReturnValue(false as never);

        await expect(checkForServicesInLiveUpdateConfigured.autoTask(actionContext)).resolves.toBe(false);
    });

    it("autoTask adds misconfigured services to internal reference", async () => {
        existsSyncSpy.mockReturnValue(false as never);

        await checkForServicesInLiveUpdateConfigured.autoTask(actionContext);

        // @ts-expect-error
        expect(checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames).toEqual([
            "service-two",
            "service-ten"
        ]);
    });

    it("autoTask handles a service in development mode which has repoContext and dockerfile", async () => {
        existsSyncSpy.mockReturnValue(false as never);

        await checkForServicesInLiveUpdateConfigured.autoTask({
            ...actionContext,
            stateManager: {
                snapshot: {
                    ...actionContext.stateManager.snapshot,
                    servicesWithLiveUpdate: [
                        "service-five"
                    ]
                }
            } as StateManager
        });

        expect(existsSyncSpy).toHaveBeenCalledWith(join(actionContext.config.projectPath, "repositories/service-five/docker-env/env.Dockerfile"));

    });

    it("getOutputViaPrompt does not prompt user when autoTask was previously successful", async () => {
        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [];

        await checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext);

        expect(confirmMock).not.toHaveBeenCalled();
    });

    it("getOutputViaPrompt runs autoTask if not previously completed", async () => {
        const autoTaskSpy = jest.spyOn(checkForServicesInLiveUpdateConfigured, "autoTask");

        autoTaskSpy.mockResolvedValue(true);

        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = undefined;

        await checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext);

        expect(autoTaskSpy).toHaveBeenCalled();
    });

    it("getOutputViaPrompt prompts user to confirm that a service missing a builder label is actually in repository", async () => {
        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [
            "service-ten"
        ];

        await checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext);

        expect(confirmMock).toHaveBeenCalledWith(
            "Should the service: service-ten use a builder?",
            {
                defaultValue: false
            }
        );
    });

    it("getOutputViaPrompt prompts user to confirm that a service is correctly repository", async () => {
        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [
            "service-seven"
        ];

        await checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext);

        expect(confirmMock).toHaveBeenCalledWith(
            "Should the service: service-seven use a builder?",
            {
                defaultValue: false
            }
        );
    });

    it("getOutputViaPrompt provides advice about how to correct a service which is correctly using repo", async () => {
        // @ts-expect-error
        confirmMock.mockResolvedValueOnce(false).mockResolvedValue(true);

        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [
            "service-ten"
        ];

        const consoleLogSpy = jest.spyOn(console, "log");

        await checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext);

        expect(consoleLogSpy).toHaveBeenCalledWith(`
To continue using a repository as the source for the service: service-ten you need to
construct a Dockerfile in the repository which is capable to building an image.`);

        expect(provideLinkToDocumentatonMock).toHaveBeenCalledWith("troubleshooting-remedies/correctly-setup-repository-builder.md");
    });

    it("getOutputViaPrompt provides advice on how to set builder label when user suggests the service should use a builder", async () => {
        // @ts-expect-error
        confirmMock.mockResolvedValue(true);

        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [
            "service-ten"
        ];

        const consoleLogSpy = jest.spyOn(console, "log");

        await checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext);

        expect(consoleLogSpy).toHaveBeenCalledWith(`
To setup the service: service-ten to use a builder you need to add the label:
'chs.local.builder' to the service with the name of a builder from list:
 * java
 * java-11
 * node
`);

        expect(provideLinkToDocumentatonMock).toHaveBeenCalledWith("troubleshooting-remedies/correctly-setup-builder.md");
    });

    it("getOutputViaPrompt prompts user to confirm they are happy with the resolution", async () => {
        // @ts-expect-error
        confirmMock.mockResolvedValue(true);

        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [
            "service-ten"
        ];

        await checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext);

        expect(confirmMock).toHaveBeenCalledWith("Do you want to continue troubleshooting?", { defaultValue: true });
    });

    it("getOutputViaPrompt returns true when no services misconfigured", async () => {
        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [];

        await expect(checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext)).resolves.toBe(true);
    });

    it("getOutputViaPrompt returns output from second prompt when services misconfigured", async () => {
        // @ts-expect-error
        confirmMock.mockResolvedValueOnce(true).mockResolvedValue(false);

        // @ts-expect-error
        checkForServicesInLiveUpdateConfigured.misconfiguredServiceNames = [
            "service-ten"
        ];

        await expect(checkForServicesInLiveUpdateConfigured.getOutputViaPrompt(actionContext)).resolves.toBe(false);
    });
});
