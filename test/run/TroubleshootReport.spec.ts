import { expect, jest } from "@jest/globals";
import { modules, services } from "../utils/data";
import { OutputTroubleshootReportTask } from "../../src/run/troubleshoot/report/OutputTroubleshootReportTask.js";
import TroubleshootReport from "../../src/run/TroubleshootReport.js";
import { Inventory } from "../../src/state/inventory.js";
import { StateManager } from "../../src/state/state-manager.js";
import { OutputTroubleshootArtifactContext } from "../../src/run/troubleshoot/report/TroubleshootArtifactContext.js";
import fs from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn as spawnMock } from "../../src/helpers/spawn-promise.js";
import LogEverythingLogHandler from "../../src/run/logs/LogEverythingLogHandler.js";
import TroubleshootAnalyses from "../../src/run/TroubleshootAnalyses.js";

const inventoryMock = {
    services,
    modules
};

const outputTroubleshootArtifactContextMock = {
    append: jest.fn(),
    write: jest.fn()
};

const stateManagerMock = {
    snapshot: {
        modules: [],
        services: [],
        servicesWithLiveUpdate: [],
        excludedServices: []
    }
};

const outputTaskMockOne = {
    run: jest.fn()
};

const outputTaskMockTwo = {
    run: jest.fn()
};

const loggerMock = {
    log: jest.fn()
};

const troubleshootAnalysesMock = {
    perform: jest.fn()
};

const tasks = [
    outputTaskMockOne as OutputTroubleshootReportTask,
    outputTaskMockTwo as OutputTroubleshootReportTask
];

const testConfig = {
    projectPath: "/home/docker",
    projectName: "docker",
    env: {}
};

jest.mock("../../src/helpers/spawn-promise");
jest.mock("../../src/run/troubleshoot/report/TroubleshootArtifactContext");
jest.mock("../../src/run/TroubleshootAnalyses");

describe("TroubleshootReport", () => {
    let troubleshootReport: TroubleshootReport;

    const tempChsDevDir = "/tmp/chs-dev";
    const mkdtempSyncSpy = jest.spyOn(fs, "mkdtempSync");
    const rmSyncSpy = jest.spyOn(fs, "rmSync");
    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    const copyFileSyncSpy = jest.spyOn(fs, "copyFileSync");

    // 2024-10-15T00:00:00.000Z
    const testDateTime = new Date(2024, 9, 15, 0, 0, 0);

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        TroubleshootAnalyses.create.mockReturnValue(troubleshootAnalysesMock);

        troubleshootReport = new TroubleshootReport(
            tasks,
            testConfig,
            inventoryMock as Inventory,
            stateManagerMock as unknown as StateManager,
            loggerMock
        );

        // @ts-expect-error
        OutputTroubleshootArtifactContext.mockReturnValue(outputTroubleshootArtifactContextMock);
        mkdtempSyncSpy.mockReturnValue(tempChsDevDir);

        copyFileSyncSpy.mockReturnValue(undefined);

        rmSyncSpy.mockReturnValue(undefined);

        // @ts-expect-error
        spawnMock.mockResolvedValue(undefined);

        // @ts-expect-error This is creating a spied version and is valid
        Date.now = () => testDateTime;
    });

    it("creates temporary directory", async () => {
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        );

        expect(mkdtempSyncSpy).toHaveBeenCalledWith(join(
            tmpdir(), "chs-dev"
        ));
    });

    it("Removes temporary directory", async () => {
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        );

        expect(rmSyncSpy).toHaveBeenCalledWith(
            tempChsDevDir,
            {
                recursive: true,
                force: true
            }
        );
    });

    it("Runs all tasks", async () => {
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        );

        expect(outputTaskMockOne.run).toHaveBeenCalledWith({
            inventory: inventoryMock,
            stateManager: stateManagerMock,
            config: testConfig,
            outputDirectory: tempChsDevDir,
            context: outputTroubleshootArtifactContextMock
        });

        expect(outputTaskMockTwo.run).toHaveBeenCalledWith({
            inventory: inventoryMock,
            stateManager: stateManagerMock,
            config: testConfig,
            outputDirectory: tempChsDevDir,
            context: outputTroubleshootArtifactContextMock
        });
    });

    it("writes context", async () => {
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        );

        expect(outputTroubleshootArtifactContextMock.write).toHaveBeenCalled();
    });

    it("produces the zip file", async () => {
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        );

        expect(spawnMock).toHaveBeenCalledWith(
            "zip",
            [
                "-j",
                "-r",
                "/home/docker/troubleshoot-2024-10-15-00:00:00.zip",
                tempChsDevDir
            ],
            {
                logHandler: expect.any(LogEverythingLogHandler)
            }
        );
    });

    it("resolves to success result when all OK", async () => {
        await expect(troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        )).resolves.toEqual({
            success: true
        });
    });

    it("removes temporary directory should zipping directory fail", async () => {
        // @ts-expect-error
        spawnMock.mockRejectedValue(new Error("error when zipping"));

        await troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        );

        expect(rmSyncSpy).toHaveBeenCalledWith(
            tempChsDevDir,
            {
                recursive: true,
                force: true
            }
        );
    });

    it("resolves to a generic unsuccessful response if zipping fails", async () => {
        // @ts-expect-error
        spawnMock.mockRejectedValue(new Error("error when zipping"));

        await expect(
            troubleshootReport.create(
                {
                    outputDirectory: "/home/docker"
                }
            )
        ).resolves.toEqual({
            success: false,
            error: "Zip file could not be created"
        });
    });

    it("produces troubleshoot analyses when not supplied", async () => {
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/" }
        );

        expect(troubleshootAnalysesMock.perform).toHaveBeenCalledWith({
            fileOut: join(tempChsDevDir, "analyses.json"),
            quiet: true
        });
    });

    it("does not produce troubleshoot analyses when not supplied and skip supplied", async () => {
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/", skipTroubleshootAnalyses: true }
        );

        expect(troubleshootAnalysesMock.perform).not.toHaveBeenCalled();
    });

    it("copies troubleshoot analyses to temporary directory when exists", async () => {
        existsSyncSpy.mockReturnValue(true);

        const analysesFile = "/home/docker/my-analyses.json";
        await troubleshootReport.create(
            { outputDirectory: "/home/docker/", troubleshootAnalyses: analysesFile }
        );

        expect(copyFileSyncSpy).toHaveBeenCalledWith(
            analysesFile,
            join(tempChsDevDir, "analyses.json")
        );
    });

    it("returns unsuccessful result when troubleshoot analyses does not exist", async () => {
        existsSyncSpy.mockReturnValue(false);

        const analysesFile = "/home/docker/my-analyses.json";

        await expect(troubleshootReport.create(
            { outputDirectory: "/home/docker/", troubleshootAnalyses: analysesFile }
        )).resolves.toEqual({ error: `Analyses: ${analysesFile} does not exist`, success: false });
    });

    it("removes temporary directory when analyses not found", async () => {
        existsSyncSpy.mockReturnValue(false);

        const analysesFile = "/home/docker/my-analyses.json";

        await troubleshootReport.create(
            { outputDirectory: "/home/docker/", troubleshootAnalyses: analysesFile }
        );

        expect(rmSyncSpy).toHaveBeenCalledWith(
            tempChsDevDir,
            {
                recursive: true,
                force: true
            }
        );
    });
});
