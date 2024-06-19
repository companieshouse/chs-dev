import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { Module, Service } from "../../src/state/inventory";
import Development from "../../src/commands/development";
// @ts-expect-error it does exist
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { Config } from "@oclif/core";

const services: Service[] = [
    {
        name: "service-one",
        description: "A Service for one and for all",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo.git"
        },
        metadata: {}
    },
    {
        name: "service-two",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo2.git",
            branch: "develop"
        },
        metadata: {}
    },
    {
        name: "service-three",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: null,
        metadata: {}
    },
    {
        name: "service-four",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: null,
        metadata: {}
    }
];

const modules: Module[] = [
    {
        name: "module-one"
    }
];
let snapshot;

const gitCloneMock = jest.fn();
const includeServiceInLiveUpdateMock = jest.fn();
const excludeServiceInLiveUpdateMock = jest.fn();

jest.mock("../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services,
                modules
            };
        }
    };
});

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot,
                includeServiceInLiveUpdate: includeServiceInLiveUpdateMock,
                excludeServiceFromLiveUpdate: excludeServiceInLiveUpdateMock
            };
        }
    };
});

jest.mock("simple-git", () => {
    return function () {
        return { clone: gitCloneMock };
    };
});

describe("Development command", () => {
    let tempDir;
    let testConfig: Config;
    let development: Development;
    const runHookMock = jest.fn();
    const parseMock = jest.fn();
    const logMock = jest.fn();
    const errorMock = jest.fn();
    const cwdSpy = jest.spyOn(process, "cwd");

    beforeAll(() => {
        jest.resetAllMocks();
        tempDir = mkdtempSync("development-command");
        // @ts-expect-error
        testConfig = { root: tempDir, configDir: join(tempDir, "config"), cacheDir: join(tempDir, "cache"), runHook: runHookMock };

        development = new Development([], testConfig);

        // @ts-expect-error
        development.parse = parseMock;
        development.log = logMock;
        // @ts-expect-error
        development.error = errorMock;
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        cwdSpy.mockReturnValue(tempDir);
    });

    it("prints services when services called", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "services"
            }
        });

        await development.run();

        expect(development.log).toHaveBeenCalledTimes(3);

        // @ts-expect-error
        const logCalls = development.log.mock.calls;

        const expectedCalls = [
            "Available services:",
            ...services.filter(service => ["service-one", "service-two"].includes(service.name)).map(service => ` - ${service.name} (${service.description})`)
        ];

        expect(logCalls).toHaveLength(expectedCalls.length);

        for (let i = 0; i < expectedCalls.length; i++) {
            const expected = expectedCalls[i];
            const actual = logCalls[i];

            expect(actual).toEqual([expected]);
        }
    });

    describe("enable", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            cwdSpy.mockReturnValue(tempDir);
        });

        it("errors when service name not supplied", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "enable",
                    services: ""
                }
            });

            await development.run();

            expect(errorMock).toHaveBeenCalledWith("Service not supplied");
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("errors when there is a list of blank services", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "enable",
                    services: ",,,"
                }
            });

            await expect(development.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalled();
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("clones repo with default branch and includes service in live update", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "enable",
                    services: "service-one"
                }
            });

            // @ts-expect-error
            gitCloneMock.mockResolvedValue(undefined);

            await expect(development.run()).resolves.toBeUndefined();

            expect(errorMock).not.toHaveBeenCalled();
            expect(runHookMock).toHaveBeenCalledTimes(2);
            expect(runHookMock).toHaveBeenNthCalledWith(1, "generate-development-docker-compose", { serviceName: "service-one" });
            expect(runHookMock).toHaveBeenNthCalledWith(2, "generate-runnable-docker-compose", {});

            expect(gitCloneMock).toHaveBeenCalledTimes(1);
            expect(gitCloneMock).toHaveBeenCalledWith("git@github.com/companieshouse/repo.git", join(tempDir, "repositories/service-one"), []);

            expect(includeServiceInLiveUpdateMock).toHaveBeenCalledWith("service-one");
        });

        it("clones branch with a specific branch", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "enable",
                    services: "service-two"
                }
            });

            // @ts-expect-error
            gitCloneMock.mockResolvedValue(undefined);

            await expect(development.run()).resolves.toBeUndefined();

            expect(errorMock).not.toHaveBeenCalled();
            expect(runHookMock).toHaveBeenCalledTimes(2);
            expect(runHookMock).toHaveBeenNthCalledWith(1, "generate-development-docker-compose", { serviceName: "service-two" });

            expect(gitCloneMock).toHaveBeenCalledWith("git@github.com/companieshouse/repo2.git", join(tempDir, "repositories/service-two"), ["--branch", "develop"]);

            expect(includeServiceInLiveUpdateMock).toHaveBeenCalledWith("service-two");
        });

        for (const serviceName of ["service-three", "service-four"]) {
            it(`errors when requested service does not have repository details (${serviceName})`, async () => {

                // @ts-expect-error
                parseMock.mockResolvedValue({
                    args: {
                        command: "enable",
                        services: serviceName
                    }
                });

                // @ts-expect-error
                gitCloneMock.mockResolvedValue(undefined);

                await expect(development.run()).resolves.toBeUndefined();

                expect(errorMock).toHaveBeenCalledWith(`Service "${serviceName}" does not have repository defined`);
            });
        }

        it("errors when service does not exist", async () => {
            const serviceName = "not-found";
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "enable",
                    services: serviceName
                }
            });

            // @ts-expect-error
            gitCloneMock.mockResolvedValue(undefined);

            await expect(development.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalledWith(`Service "${serviceName}" is not defined in inventory`);
        });
    });

    describe("disable", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            cwdSpy.mockReturnValue(tempDir);
        });

        it("errors when service name not supplied", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "disable",
                    services: ""
                }
            });

            await development.run();

            expect(errorMock).toHaveBeenCalledWith("Service not supplied");
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("errors when there is a list of blank services", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "disable",
                    services: ",,,"
                }
            });

            await expect(development.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalled();
            expect(runHookMock).not.toHaveBeenCalled();
        });

        it("errors when service does not exist", async () => {
            const serviceName = "not-found";
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "disable",
                    services: serviceName
                }
            });

            // @ts-expect-error
            gitCloneMock.mockResolvedValue(undefined);

            await expect(development.run()).resolves.toBeUndefined();

            expect(errorMock).toHaveBeenCalledWith(`Service "${serviceName}" is not defined in inventory`);
        });

        it("removes service from live update and regenerates docker compose file", async () => {
            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "disable",
                    services: "service-two"
                }
            });

            // @ts-expect-error
            gitCloneMock.mockResolvedValue(undefined);

            await expect(development.run()).resolves.toBeUndefined();

            expect(errorMock).not.toHaveBeenCalled();
            expect(runHookMock).toHaveBeenCalledTimes(1);
            expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});

            expect(excludeServiceInLiveUpdateMock).toHaveBeenCalledWith("service-two");

        });
    });
});
