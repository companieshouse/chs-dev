import { expect, jest } from "@jest/globals";
import Available from "../../../src/commands/modules/available";
import { modules } from "../../utils/data";
import { Config } from "@oclif/core";

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                modules
            };
        }
    };
});

describe("modules available", () => {

    let logMock;
    let availableModules: Available;

    beforeEach(() => {
        jest.resetAllMocks();

        availableModules = new Available([], {
            cacheDir: "./cache-dir"
        } as Config);
        logMock = jest.spyOn(availableModules, "log");
    });

    it("logs all modules available", async () => {
        await availableModules.run();

        expect(logMock).toHaveBeenCalledTimes(modules.length + 1);
        expect(logMock).toHaveBeenCalledWith("Available modules:");

        for (const { name } of modules) {
            expect(logMock).toHaveBeenCalledWith(` - ${name}`);
        }
    });
});
