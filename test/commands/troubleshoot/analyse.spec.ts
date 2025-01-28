import { expect, jest } from "@jest/globals";
import { modules, services } from "../../utils/data";
import { Inventory } from "../../../src/state/inventory";
import { StateManager } from "../../../src/state/state-manager";
import Analyse from "../../../src/commands/troubleshoot/analyse";
import { Config } from "@oclif/core";
import TroubleshootAnalyses from "../../../src/run/TroubleshootAnalyses";
import loadMock from "../../../src/helpers/config-loader";

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

const troubleshootAnalysesMock = {
    perform: jest.fn()
};

jest.mock("../../../src/state/inventory");
jest.mock("../../../src/state/state-manager");
jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/run/TroubleshootAnalyses");

describe("Analyse", () => {
    let exitSpy;
    let parseSpy;

    let analyse: Analyse;

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        // @ts-expect-error
        StateManager.mockReturnValue(stateManagerMock);

        // @ts-expect-error
        TroubleshootAnalyses.create.mockReturnValue(troubleshootAnalysesMock);

        // @ts-expect-error
        loadMock.mockReturnValue(configMock);

        analyse = new Analyse([], {
            root: "./", configDir: "./config", cacheDir: "./cache"
        } as Config);

        troubleshootAnalysesMock.perform.mockResolvedValue({
            success: true
        } as never);

        exitSpy = jest.spyOn(analyse, "exit");

        // @ts-expect-error
        parseSpy = jest.spyOn(analyse, "parse");

        parseSpy.mockResolvedValue({
            flags: {
                quiet: false
            },
            args: {
                outputFile: undefined
            }
        });

        exitSpy.mockResolvedValue(undefined);
    });

    it("performs the analyses on the environment", async () => {
        await analyse.run();

        expect(troubleshootAnalysesMock.perform).toHaveBeenCalledWith({});
    });

    it("exits with 0 exit when successful analyses", async () => {
        await analyse.run();

        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits with 1 exit when unsuccessful analyses", async () => {
        troubleshootAnalysesMock.perform.mockResolvedValue({
            success: false
        } as never);

        await analyse.run();

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("passes quiet and fileOut options", async () => {
        parseSpy.mockResolvedValue({
            flags: {
                quiet: true
            },
            args: {
                outputFile: "/home/user/fileout"
            }
        });

        await analyse.run();

        expect(troubleshootAnalysesMock.perform).toHaveBeenCalledWith({
            quiet: true,
            fileOut: "/home/user/fileout"
        });

    });
});
