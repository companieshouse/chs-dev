import { expect, jest } from "@jest/globals";
import Available from "../../../src/commands/modules/available";
import { modules } from "../../utils/data";
import { Config } from "@oclif/core";
import { parse } from "path";

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
    let logJsonMock;
    let parseMock;
    let availableModules: Available;

    beforeEach(() => {
        jest.resetAllMocks();

        availableModules = new Available([], {
            cacheDir: "./cache-dir"
        } as Config);

        logMock = jest.spyOn(availableModules, "log");

        // @ts-expect-error
        logJsonMock = jest.spyOn(availableModules, "logJson");

        // @ts-expect-error
        parseMock = jest.spyOn(availableModules, "parse");
    });

    it("logs all modules available", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: false
            }
        });

        await availableModules.run();

        expect(logMock).toHaveBeenCalledTimes(modules.length + 1);
        expect(logMock).toHaveBeenCalledWith("Available modules:");

        for (const { name } of modules) {
            expect(logMock).toHaveBeenCalledWith(` - ${name}`);
        }

        expect(logJsonMock).not.toHaveBeenCalled();
    });

    it("can output json", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: true
            }
        });

        await availableModules.run();

        expect(logJsonMock).toHaveBeenCalledWith({
            modules: modules.map(({ name }) => name)
        });

        expect(logMock).not.toHaveBeenCalled();
    });
});
