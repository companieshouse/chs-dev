import { expect, jest } from "@jest/globals";
import { modules, services } from "../../utils/data";
import Enable from "../../../src/commands/development/enable";
import { Config } from "@oclif/core";
import simpleGitMock from "simple-git";
import { join } from "path";

const includeServiceInLiveUpdateMock = jest.fn();
let snapshot;

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services,
                modules
            };
        }
    };
});

jest.mock("../../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot,
                includeServiceInLiveUpdate: includeServiceInLiveUpdateMock
            };
        }
    };
});

jest.mock("simple-git");

describe("development enable", () => {

    let developmentEnable: Enable;

    const parseMock = jest.fn();
    const errorMock = jest.fn();
    const runHookMock = jest.fn();
    const gitCloneMock = jest.fn();
    const projectDir = "./project";
    const cwdSpy = jest.spyOn(process, "cwd");

    beforeEach(() => {
        jest.resetAllMocks();

        developmentEnable = new Enable(
            // @ts-expect-error
            [], { cacheDir: "./caches", runHook: runHookMock } as Config
        );

        // @ts-expect-error
        developmentEnable.parse = parseMock;
        // @ts-expect-error
        developmentEnable.error = errorMock;

        cwdSpy.mockReturnValue(projectDir);

        // @ts-expect-error
        simpleGitMock.mockReturnValue({
            clone: gitCloneMock
        });
    });

    it("errors when service name not supplied", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                services: ""
            },
            argv: []
        });

        await developmentEnable.run();

        expect(errorMock).toHaveBeenCalledWith("Service not supplied");
        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("errors when there is a list of blank services", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                services: ""
            },
            argv: [
                "",
                "",
                ""
            ]
        });

        await expect(developmentEnable.run()).rejects.toEqual(new Error("Service \"\" is not defined in inventory"));

        expect(runHookMock).not.toHaveBeenCalled();
    });

    it("clones repo with default branch and includes service in live update", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                services: "service-one"
            },
            argv: [
                "service-one"
            ]
        });

        await expect(developmentEnable.run()).resolves.toBeUndefined();

        expect(errorMock).not.toHaveBeenCalled();
        expect(runHookMock).toHaveBeenCalledTimes(2);
        expect(runHookMock).toHaveBeenNthCalledWith(1, "generate-development-docker-compose", { serviceName: "service-one" });
        expect(runHookMock).toHaveBeenNthCalledWith(2, "generate-runnable-docker-compose", {});

        expect(gitCloneMock).toHaveBeenCalledTimes(1);
        expect(gitCloneMock).toHaveBeenCalledWith("git@github.com/companieshouse/repo-one.git", join(projectDir, "repositories/service-one"), []);

        expect(includeServiceInLiveUpdateMock).toHaveBeenCalledWith("service-one");
    });

    it("clones branch with a specific branch", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                services: "service-two"
            },
            argv: [
                "service-two"
            ]
        });

        // @ts-expect-error
        gitCloneMock.mockResolvedValue(undefined);

        await expect(developmentEnable.run()).resolves.toBeUndefined();

        expect(errorMock).not.toHaveBeenCalled();
        expect(runHookMock).toHaveBeenCalledTimes(2);
        expect(runHookMock).toHaveBeenNthCalledWith(1, "generate-development-docker-compose", { serviceName: "service-two" });

        expect(gitCloneMock).toHaveBeenCalledWith("git@github.com/companieshouse/repo2.git", join(projectDir, "repositories/service-two"), ["--branch", "develop"]);

        expect(includeServiceInLiveUpdateMock).toHaveBeenCalledWith("service-two");
    });

    for (const serviceName of ["service-three", "service-six"]) {
        it(`errors when requested service does not have repository details (${serviceName})`, async () => {

            // @ts-expect-error
            parseMock.mockResolvedValue({
                args: {
                    command: "enable",
                    services: serviceName
                },
                argv: [
                    serviceName
                ]
            });

            // @ts-expect-error
            gitCloneMock.mockResolvedValue(undefined);

            await expect(developmentEnable.run()).resolves.toBeUndefined();

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
            },
            argv: [
                serviceName
            ]
        });

        // @ts-expect-error
        gitCloneMock.mockResolvedValue(undefined);

        await expect(developmentEnable.run()).rejects.toEqual(new Error(
            `Service "${serviceName}" is not defined in inventory`
        ));
    });

    it("can handle multiple services", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                command: "enable",
                services: "service-one"
            },
            argv: [
                "service-one",
                "service-two"
            ]
        });

        await expect(developmentEnable.run()).resolves.toBeUndefined();

        expect(runHookMock).toHaveBeenCalledTimes(3);
        expect(runHookMock).toHaveBeenCalledWith("generate-development-docker-compose", { serviceName: "service-one" });
        expect(runHookMock).toHaveBeenCalledWith("generate-development-docker-compose", { serviceName: "service-two" });
        expect(runHookMock).toHaveBeenCalledWith("generate-runnable-docker-compose", {});
    });

});
