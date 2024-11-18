import { expect, jest } from "@jest/globals";
import { Inventory } from "../../../src/state/inventory";
import { StateManager } from "../../../src/state/state-manager";
import { modules, services } from "../../utils/data";
import TroubleshootReport from "../../../src/run/TroubleshootReport";
import loadMock from "../../../src/helpers/config-loader";
import Report from "../../../src/commands/troubleshoot/report";
import { Config } from "@oclif/core";

const inventoryMock = {
    services,
    modules
} as Inventory;

const stateManagerMock = {
    snapshot: {
        services: [] as string[],
        modules: [] as string[],
        servicesWithLiveUpdate: [] as string[],
        excludedServices: [] as string[]
    }
} as StateManager;

const configMock = {
    projectPath: "/home/user/docker",
    projectName: "docker",
    env: {}
};

const troubleshootReportMock = {
    create: jest.fn()
};

jest.mock("../../../src/state/inventory");
jest.mock("../../../src/state/state-manager");
jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/run/TroubleshootReport");

describe("Report", () => {

    let exitSpy;
    let parseSpy;
    let report: Report;

    beforeEach(() => {
        jest.resetAllMocks();

        jest.resetAllMocks();

        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        // @ts-expect-error
        StateManager.mockReturnValue(stateManagerMock);

        // @ts-expect-error
        TroubleshootReport.create.mockReturnValue(troubleshootReportMock);

        // @ts-expect-error
        loadMock.mockReturnValue(configMock);

        report = new Report([], {
            root: "./", configDir: "./config", cacheDir: "./cache"
        } as Config);

        exitSpy = jest.spyOn(report, "exit");

        // @ts-expect-error
        parseSpy = jest.spyOn(report, "parse");

        parseSpy.mockResolvedValue({
            flags: {
                skipTroubleshootAnalyses: false
            },
            args: {
                outputDirectory: "/home/docker/output"
            }
        });

        exitSpy.mockResolvedValue(undefined);
    });

    it("creates report", async () => {
        await report.run();

        expect(troubleshootReportMock.create).toBeCalledWith({
            outputDirectory: "/home/docker/output"
        });
    });

    it("creates report using analyses", async () => {

        parseSpy.mockResolvedValue({
            flags: {
                skipTroubleshootAnalyses: false,
                troubleshootAnalyses: "/home/docker/analyses.json"
            },
            args: {
                outputDirectory: "/home/docker/output"
            }
        });
        await report.run();

        expect(troubleshootReportMock.create).toBeCalledWith({
            outputDirectory: "/home/docker/output",
            troubleshootAnalyses: "/home/docker/analyses.json"
        });

    });

    it("skips creating analyses", async () => {

        parseSpy.mockResolvedValue({
            flags: {
                skipTroubleshootAnalyses: true,
                troubleshootAnalyses: "/home/docker/analyses.json"
            },
            args: {
                outputDirectory: "/home/docker/output"
            }
        });
        await report.run();

        expect(troubleshootReportMock.create).toBeCalledWith({
            outputDirectory: "/home/docker/output",
            troubleshootAnalyses: "/home/docker/analyses.json",
            skipTroubleshootAnalyses: true
        });

    });
});
