import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Service } from "../../src/state/inventory";
// @ts-expect-error it does exist
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { Config } from "@oclif/core";
import Exclusions from "../../src/commands/exclusions";

const excludeFileMock = jest.fn();
const includeFileMock = jest.fn();
let snapshot;

const services: Service[] = [{
    name: "service-one",
    module: "module-one",
    source: "",
    dependsOn: [],
    builder: "",
    metadata: {}
}];

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot,
                excludeFile: excludeFileMock,
                includeFile: includeFileMock
            };
        }
    };
});

jest.mock("../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services
            };
        }
    };
});

describe("Exclusions command", () => {

    let tempDir;
    let testConfig: Config;
    let exclusions: Exclusions;
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();
    const cwdSpy = jest.spyOn(process, "cwd");

    beforeAll(() => {
        jest.resetAllMocks();
        tempDir = mkdtempSync("exclusions-command");
        // @ts-expect-error
        testConfig = { root: tempDir, configDir: join(tempDir, "config"), runHook: runHookMock };

        exclusions = new Exclusions([], testConfig);

        // @ts-expect-error
        exclusions.parse = parseMock;
        exclusions.log = logMock;
        // @ts-expect-error
        exclusions.error = errorMock;
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        cwdSpy.mockReturnValue(tempDir);
    });

    describe("include", () => {
        beforeEach(() => {
            jest.resetAllMocks();
        });

        it("errors when service name not supplied", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "include",
                    exclusions: ""
                }
            });

            await exclusions.run();

            expect(errorMock).toHaveBeenCalledWith("Exclusion must be provided");
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("errors when there is a list of blank services", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "include",
                    exclusions: ",,,"
                }
            });

            await expect(exclusions.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalled();
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("errors when service does not exist", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "include",
                    exclusions: "service-three,service-two"
                }
            });

            await expect(exclusions.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalled();
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("adds exclusion and runs hook to regenerate docker compose file", async () => {

            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "include",
                    exclusions: "service-one"
                }
            });

            await expect(exclusions.run()).resolves.toBeUndefined();

            expect(errorMock).not.toHaveBeenCalled();
            expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
            expect(excludeFileMock).toHaveBeenCalledWith("service-one");
        });

    });

    describe("exclude", () => {

        beforeEach(() => {
            jest.resetAllMocks();
        });

        it("errors when service name not supplied", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "exclude",
                    exclusions: ""
                }
            });

            await exclusions.run();

            expect(errorMock).toHaveBeenCalledWith("Exclusion must be provided");
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("errors when there is a list of blank services", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "exclude",
                    exclusions: ",,,"
                }
            });

            await expect(exclusions.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalled();
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("errors when service does not exist", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "exclude",
                    exclusions: "service-three,service-two"
                }
            });

            await expect(exclusions.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalled();
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("adds exclusion and runs hook to regenerate docker compose file", async () => {

            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "exclude",
                    exclusions: "service-one"
                }
            });

            await expect(exclusions.run()).resolves.toBeUndefined();

            expect(errorMock).not.toHaveBeenCalled();
            expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
            expect(includeFileMock).toHaveBeenCalledWith("service-one");
        });
    });
});
