import { jest, expect } from "@jest/globals";
import { services, modules } from "../utils/data";
import { StateManager } from "../../src/state/state-manager";
import { Inventory } from "../../src/state/inventory";
import State from "../../src/model/State";
import { Troubleshooter } from "../../src/run/troubleshooter";
import fs from "fs";
import os from "os";
import { join } from "path";
import { TroubleshootAction, TroubleshootActionContext } from "../../src/run/troubleshoot/action/TroubleshootAction";
import { defaultTroubleshootActions } from "../../src/run/troubleshoot/action/default-troubleshoot-actions";
import { defaultTroubleshootArtifactTasks } from "../../src/run/troubleshoot/artifact/default-troubleshoot-artifact-tasks";
import { OutputTroubleshootArtifactTask } from "../../src/run/troubleshoot/artifact/OutputTroubleshootArtifactTask";
import { spawn as spawnMock } from "../../src/helpers/spawn-promise";
import LogEverythingLogHandler from "../../src/run/logs/LogEverythingLogHandler";
import { OutputTroubleshootArtifactContext } from "../../src/run/troubleshoot/artifact/TroubleshootArtifactContext";

const inventoryMock = {
    services,
    modules
};

const outputTroubleshootArtifactContextMock = {
    append: jest.fn(),
    write: jest.fn()
};

let snapshot: State = {
    modules: [],
    services: [],
    servicesWithLiveUpdate: [],
    excludedServices: []
};

jest.mock("../../src/state/inventory");
jest.mock("../../src/state/state-manager");
jest.mock("../../src/helpers/spawn-promise");
jest.mock("../../src/run/troubleshoot/artifact/TroubleshootArtifactContext");

describe("Troubleshooter", () => {
    const config = {
        projectName: "docker-project",
        projectPath: join(process.cwd(), "test/data/troubleshooter"),
        env: {}
    };

    const troubleshootActionMockOne = {
        autoTask: jest.fn(),
        getOutputViaPrompt: jest.fn()
    };

    const troubleshootActionMockTwo = {
        getOutputViaPrompt: jest.fn()
    };

    const troubleshootActionMockThree = {
        autoTask: jest.fn()
    };

    const outputTroubleshootArtifactTaskMockOne = {
        run: jest.fn()
    };

    const outputTroubleshootArtifactTaskMockTwo = {
        run: jest.fn()
    };

    const outputTroubleshootArtifactTaskMockThree = {
        run: jest.fn()
    };

    const troubleshootActions: TroubleshootAction[] = [
        troubleshootActionMockOne as TroubleshootAction,
        troubleshootActionMockTwo as TroubleshootAction,
        troubleshootActionMockThree as TroubleshootAction
    ];

    const outputTroubleshootArtifactTasks: OutputTroubleshootArtifactTask[] = [
        outputTroubleshootArtifactTaskMockOne as OutputTroubleshootArtifactTask,
        outputTroubleshootArtifactTaskMockTwo as OutputTroubleshootArtifactTask,
        outputTroubleshootArtifactTaskMockThree as OutputTroubleshootArtifactTask
    ];

    const loggerMock = {
        log: jest.fn()
    };

    let troubleshooter: Troubleshooter;
    const mkdtempSyncSpy = jest.spyOn(fs, "mkdtempSync");
    const rmSyncSpy = jest.spyOn(fs, "rmSync");
    const tmpdirSpy = jest.spyOn(os, "tmpdir");

    const temporaryDirectory = "/tmp/";

    // 2024-10-15T00:00:00.000Z
    const testDateTime = new Date(2024, 9, 15, 0, 0, 0);

    beforeEach(() => {
        jest.resetAllMocks();

        snapshot = {
            modules: [],
            services: [],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };

        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        // @ts-expect-error
        StateManager.mockReturnValue({
            snapshot
        });

        // @ts-expect-error
        OutputTroubleshootArtifactContext.mockReturnValue(outputTroubleshootArtifactContextMock);

        troubleshooter = Troubleshooter.createNew(
            config,
            "/users/caches/chs-dev",
            loggerMock,
            troubleshootActions,
            outputTroubleshootArtifactTasks
        );

        tmpdirSpy.mockReturnValue(temporaryDirectory);
        mkdtempSyncSpy.mockReturnValue(join(temporaryDirectory, "chs-dev-12345"));
        rmSyncSpy.mockReturnValue(undefined);

        // @ts-expect-error
        spawnMock.mockResolvedValue(undefined);

        // @ts-expect-error This is creating a spied version and is valid
        Date.now = () => testDateTime;
    });

    describe("createNew", () => {
        it("sets default troubleshootActions when not supplied", () => {
            expect(Troubleshooter.createNew(
                config,
                "/users/caches/chs-dev2",
                loggerMock
            // @ts-expect-error
            ).troubleshootActions).toEqual(defaultTroubleshootActions);
        });

        it("sets troubleshootActions when supplied", () => {
            expect(Troubleshooter.createNew(
                config,
                "/users/caches/chs-dev2",
                loggerMock,
                troubleshootActions
            // @ts-expect-error
            ).troubleshootActions).toEqual(troubleshootActions);
        });

        it("sets default output artifact tasks when not supplied", () => {

            expect(Troubleshooter.createNew(
                config,
                "/users/caches/chs-dev2",
                loggerMock
            // @ts-expect-error
            ).outputTroubleshootArtifactTasks).toEqual(defaultTroubleshootArtifactTasks);
        });

        it("sets troubleshootActions when supplied", () => {
            expect(Troubleshooter.createNew(
                config,
                "/users/caches/chs-dev2",
                loggerMock,
                troubleshootActions,
                outputTroubleshootArtifactTasks
            // @ts-expect-error
            ).outputTroubleshootArtifactTasks).toEqual(outputTroubleshootArtifactTasks);
        });
    });

    it("attemptResolution runs all auto mode and does not call their prompts when they resolved", async () => {
        troubleshootActionMockOne.autoTask.mockResolvedValue(true as never);
        troubleshootActionMockThree.autoTask.mockResolvedValue(true as never);

        await troubleshooter.attemptResolution(false);

        expect(troubleshootActionMockOne.autoTask).toHaveBeenCalledWith({
            inventory: inventoryMock,
            stateManager: {
                snapshot
            },
            config
        });
        expect(troubleshootActionMockThree.autoTask).toHaveBeenCalledWith({
            inventory: inventoryMock,
            stateManager: {
                snapshot
            },
            config
        });

        expect(troubleshootActionMockOne.getOutputViaPrompt).not.toHaveBeenCalled();
    });

    it("attemptResolution autoMode defaults to false", async () => {
        troubleshootActionMockOne.autoTask.mockResolvedValue(false as never);
        troubleshootActionMockOne.getOutputViaPrompt.mockResolvedValue(true as never);
        troubleshootActionMockThree.autoTask.mockResolvedValue(true as never);

        await troubleshooter.attemptResolution();

        expect(troubleshootActionMockOne.getOutputViaPrompt).toHaveBeenCalledTimes(1);

    });

    it("attemptResolution runs auto mode and calls prompts when they return false", async () => {
        troubleshootActionMockOne.autoTask.mockResolvedValue(false as never);
        troubleshootActionMockOne.getOutputViaPrompt.mockResolvedValue(true as never);
        troubleshootActionMockThree.autoTask.mockResolvedValue(true as never);

        await troubleshooter.attemptResolution(false);

        expect(troubleshootActionMockOne.getOutputViaPrompt).toHaveBeenCalledTimes(1);
    });

    it("attemptResolution runs auto mode and does not call prompt when they return false and only autoMode", async () => {
        troubleshootActionMockOne.autoTask.mockResolvedValue(false as never);
        troubleshootActionMockOne.getOutputViaPrompt.mockResolvedValue(true as never);
        troubleshootActionMockThree.autoTask.mockResolvedValue(true as never);

        await troubleshooter.attemptResolution(true);

        expect(troubleshootActionMockOne.getOutputViaPrompt).not.toHaveBeenCalled();
    });

    it("attemptResolution returns true when all tasks return true", async () => {
        troubleshootActionMockOne.autoTask.mockResolvedValue(true as never);
        troubleshootActionMockTwo.getOutputViaPrompt.mockResolvedValue(true as never);
        troubleshootActionMockThree.autoTask.mockResolvedValue(true as never);

        const result = await troubleshooter.attemptResolution(false);

        expect(result).toBe(true);
    });

    it("attemptResolution returns true when prompt return true after autotask failure", async () => {
        troubleshootActionMockOne.autoTask.mockResolvedValue(false as never);
        troubleshootActionMockOne.getOutputViaPrompt.mockResolvedValue(true as never);
        troubleshootActionMockTwo.getOutputViaPrompt.mockResolvedValue(true as never);
        troubleshootActionMockThree.autoTask.mockResolvedValue(true as never);

        const result = await troubleshooter.attemptResolution(false);

        expect(result).toBe(true);
    });

    it("attemptResolution returns false when prompt return true after autotask and prompt failure", async () => {
        troubleshootActionMockOne.autoTask.mockResolvedValue(false as never);
        troubleshootActionMockOne.getOutputViaPrompt.mockResolvedValue(false as never);
        troubleshootActionMockTwo.getOutputViaPrompt.mockResolvedValue(true as never);
        troubleshootActionMockThree.autoTask.mockResolvedValue(true as never);

        const result = await troubleshooter.attemptResolution(false);

        expect(result).toBe(false);
    });

    it("outputTroubleshootArtifact creates temporary directory", async () => {
        await troubleshooter.outputTroubleshootArtifact("/users/test-user/output");

        expect(mkdtempSyncSpy).toHaveBeenCalledWith(join(temporaryDirectory, "chs-dev"));
    });

    it("outputTroubleshootArtifact deletes temporary directory", async () => {
        await troubleshooter.outputTroubleshootArtifact("/users/test-user/output");

        expect(rmSyncSpy).toHaveBeenCalledWith(
            join(temporaryDirectory, "chs-dev-12345"),
            {
                recursive: true
            }
        );
    });

    it("outputTroubleshootArtifact calls all tasks", async () => {
        outputTroubleshootArtifactTaskMockOne.run.mockResolvedValue(true as never);
        outputTroubleshootArtifactTaskMockTwo.run.mockResolvedValue(true as never);
        outputTroubleshootArtifactTaskMockThree.run.mockResolvedValue(true as never);

        await troubleshooter.outputTroubleshootArtifact("/users/test-user/output");

        expect(outputTroubleshootArtifactTaskMockOne.run).toHaveBeenCalledWith({
            inventory: inventoryMock,
            stateManager: {
                snapshot
            },
            outputDirectory: join(temporaryDirectory, "chs-dev-12345"),
            config,
            context: expect.anything()
        });

        expect(outputTroubleshootArtifactTaskMockTwo.run).toHaveBeenCalledWith({
            inventory: inventoryMock,
            stateManager: {
                snapshot
            },
            outputDirectory: join(temporaryDirectory, "chs-dev-12345"),
            config,
            context: expect.anything()
        });

        expect(outputTroubleshootArtifactTaskMockThree.run).toHaveBeenCalledWith({
            inventory: inventoryMock,
            stateManager: {
                snapshot
            },
            outputDirectory: join(temporaryDirectory, "chs-dev-12345"),
            config,
            context: expect.anything()
        });

    });

    it("outputTroubleshootArtifact does not call task when one fails", async () => {
        outputTroubleshootArtifactTaskMockOne.run.mockRejectedValue("Some error" as never);

        await expect(troubleshooter.outputTroubleshootArtifact("/users/test-user/output")).rejects.toEqual("Some error");

        expect(outputTroubleshootArtifactTaskMockTwo.run).not.toHaveBeenCalled();
        expect(outputTroubleshootArtifactTaskMockThree.run).not.toHaveBeenCalled();
    });

    it("outputTroubleshootArtifact removes temporary directory if one rejects", async () => {
        outputTroubleshootArtifactTaskMockOne.run.mockRejectedValue("Some error" as never);

        await expect(troubleshooter.outputTroubleshootArtifact("/users/test-user/output")).rejects.toEqual(expect.anything());

        expect(rmSyncSpy).toHaveBeenCalledWith(
            join(temporaryDirectory, "chs-dev-12345"),
            {
                recursive: true
            }
        );
    });

    it("outputTroubleshootArtifact creates zip file using zip utility of the output directory", async () => {
        outputTroubleshootArtifactTaskMockOne.run.mockResolvedValue(true as never);
        outputTroubleshootArtifactTaskMockTwo.run.mockResolvedValue(true as never);
        outputTroubleshootArtifactTaskMockThree.run.mockResolvedValue(true as never);

        await troubleshooter.outputTroubleshootArtifact("/users/test-user/output");

        expect(spawnMock).toHaveBeenCalledWith(
            "zip",
            [
                "-j",
                "-r",
                "/users/test-user/output/troubleshoot-2024-10-15-00:00:00.zip",
                join(temporaryDirectory, "chs-dev-12345")
            ],
            {
                logHandler: expect.any(LogEverythingLogHandler)
            }
        );
    });

    it("outputTroubleshootArtifact writes context", async () => {
        outputTroubleshootArtifactTaskMockOne.run.mockResolvedValue(true as never);
        outputTroubleshootArtifactTaskMockTwo.run.mockResolvedValue(true as never);
        outputTroubleshootArtifactTaskMockThree.run.mockResolvedValue(true as never);

        await troubleshooter.outputTroubleshootArtifact("/users/test-user/output");

        expect(outputTroubleshootArtifactContextMock.write).toHaveBeenCalledTimes(1);

    });
});
