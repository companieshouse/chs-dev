import { expect, jest } from "@jest/globals";
import Sync from "../../src/commands/sync";
import { Config } from "@oclif/core";

const runSynchronisationMock = jest.fn();

jest.mock("../../src/run/sync-versions", function () {
    return {
        SynchronizeChsDevVersion: function () {
            return {
                run: runSynchronisationMock
            };
        }
    };
});

describe("Sync command", () => {

    let testConfig: Config;
    const parseMock = jest.fn();
    let sync: Sync;

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        testConfig = {};
        sync = new Sync([], testConfig);

        // @ts-expect-error
        sync.parse = parseMock;
    });

    it("runs synchronisation with default values when no flags supplied", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                version: "latest",
                force: false
            }
        });

        await sync.run();

        expect(runSynchronisationMock).toHaveBeenCalledWith(false, "latest");

    });

    it("runs synchronisation with values of flags when flags supplied", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            flags: {
                version: "0.1.2",
                force: true
            }
        });

        await sync.run();

        expect(runSynchronisationMock).toHaveBeenCalledWith(true, "0.1.2");

    });
});
