import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";

// @ts-expect-error
import { mkdtempSync, rmSync } from "fs";
import Down from "../../src/commands/down";
import { join } from "path";

const dockerComposeDownMock = jest.fn();

jest.mock("../../src/run/docker-compose", () => {
    return {
        DockerCompose: function () {
            return { down: dockerComposeDownMock };
        }
    };
});

jest.mock("../../src/helpers/config-loader", function () {
    return jest.fn().mockImplementation(() => ({
        env: {},
        projectPath: "."
    }));
});

describe("Down command", () => {
    let tempDir;
    let testConfig: Config;
    let downCommand: Down;
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();
    const cwdSpy = jest.spyOn(process, "cwd");

    beforeAll(() => {
        jest.resetAllMocks();
        tempDir = mkdtempSync("down-command");
        // @ts-expect-error
        testConfig = { root: tempDir, configDir: join(tempDir, "config"), cacheDir: join(tempDir, "cache"), runHook: runHookMock };

        downCommand = new Down([], testConfig);

        // @ts-expect-error
        downCommand.parse = parseMock;
        downCommand.log = logMock;
        // @ts-expect-error
        downCommand.error = errorMock;
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        cwdSpy.mockReturnValue(tempDir);
    });

    it("takes down the environment", async () => {
        await downCommand.run();

        expect(dockerComposeDownMock).toHaveBeenCalledTimes(1);
    });
});
