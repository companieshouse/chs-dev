import { expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";
import { existsSync } from "fs";
import Export from "../../../src/commands/state/export";
import configLoaderMock from "../../../src/helpers/config-loader";
import { confirm as confirmMock } from "../../../src/helpers/user-input";
import ChsDevConfig from "../../../src/model/Config";
import State from "../../../src/model/State";
import { StateManager } from "../../../src/state/state-manager";

jest.mock("fs");
jest.mock("yaml");
jest.mock("../../../src/state/state-manager");
jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/helpers/user-input");

const chsDevConfig: ChsDevConfig = {
    projectPath: "./docker-chs",
    projectName: "docker-chs",
    env: {},
    versionSpecification: "<=0.1.16"
};

const stateSnapshot = {
    modules: [],
    services: [
        "service-one"
    ],
    servicesWithLiveUpdate: [],
    excludedServices: []
};

describe("Export state command", () => {
    let exportState: Export;
    let testConfig: Config;
    let exportStateMock;

    let parseMock: any;

    const setUpCommand = (snapshot: State) => {

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache" };

        // @ts-expect-error
        StateManager.mockReturnValue({ snapshot });

        // @ts-expect-error
        configLoaderMock.mockReturnValue(chsDevConfig);

        exportState = new Export([], testConfig);

        // @ts-expect-error
        parseMock = jest.spyOn(exportState, "parse");

        parseMock.mockResolvedValue({
            args: {
                name: "exportedState"
            }
        });
        (confirmMock as jest.Mock).mockReturnValue(true);
        exportStateMock = jest.spyOn(exportState as any, "exportState");
        jest.spyOn(exportState as any, "getExportData").mockImplementation(() => {});
    };

    beforeEach(() => {
        jest.resetAllMocks();

        (existsSync as jest.Mock).mockReturnValue(true);
        setUpCommand(stateSnapshot);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should call exportState if user confirms", async () => {
        parseMock.mockResolvedValue({ args: { name: "testExport" } });

        await exportState.run();

        expect(exportStateMock).toHaveBeenCalledWith("testExport");
    });

    it("should not call exportState if user declines", async () => {
        parseMock.mockResolvedValue({ args: { name: "testExport" } });
        (confirmMock as jest.Mock).mockReturnValue(false);
        await exportState.run();

        expect(exportStateMock).not.toHaveBeenCalled();
    });

    it("should prompt with correct message", async () => {
        parseMock.mockResolvedValue({ args: { name: "myExport" } });

        await exportState.run();

        expect(confirmMock).toHaveBeenCalledWith(
            expect.stringContaining("Export current state of chs-dev to file: myExport?")
        );
    });

});
