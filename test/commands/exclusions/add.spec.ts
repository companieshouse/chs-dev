import { expect, jest } from "@jest/globals";
import Add from "../../../src/commands/exclusions/add";
import { services } from "../../utils/data";

const addExclusionForServiceMock = jest.fn();

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services
            };
        }
    };
});

jest.mock("../../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                addExclusionForService: addExclusionForServiceMock,
                snapshot: {
                    excludedServices: ["serviceA", "serviceB"]
                }
            };
        }
    };
});

describe("exclusions add", () => {
    const runHookMock = jest.fn();
    const commandArgvMock = ["overseas-entities-api"];

    let exclusionsAdd;
    let parseMock;
    let handlePreHookCheckMock;
    let handleServiceModuleStateHookMock;

    beforeEach(() => {
        jest.resetAllMocks();

        exclusionsAdd = new Add(
            [], {
                // @ts-expect-error
                runHook: runHookMock
            }
        );

        parseMock = jest.spyOn(exclusionsAdd, "parse");
        handleServiceModuleStateHookMock = jest.spyOn(exclusionsAdd as any, "handleServiceModuleStateHook").mockReturnValue([]);
        handlePreHookCheckMock = jest.spyOn(exclusionsAdd as any, "handlePreHookCheck").mockReturnValue(undefined);
    });

    for (const invalidService of [null, undefined, "service-not-found"]) {
        it(`rejects invalid service name ${invalidService}`, async () => {
            parseMock.mockResolvedValue({
                args: {
                    service: invalidService
                },
                argv: [
                    invalidService
                ]
            });

            await expect(exclusionsAdd.run()).rejects.toEqual(expect.any(Error));
        });
    }

    it("adds exclusion for valid service", async () => {
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            argv: [
                "service-one"
            ]
        });

        await exclusionsAdd.run();

        expect(addExclusionForServiceMock).toHaveBeenCalledWith("service-one");
    });

    it("regenerates the docker compose", async () => {
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            argv: [
                "service-one"
            ]
        });

        await exclusionsAdd.run();

        expect(runHookMock).toHaveBeenCalledWith(
            "generate-runnable-docker-compose", {}
        );
    });

    it("should call the pre hook check then execute the command if there are no warnings", async () => {
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            argv: [
                "service-one"
            ]
        });
        const handleExclusionsAndDevelopmentCommandMock = jest.spyOn(exclusionsAdd as any, "handleExclusionsAndDevelopmentCommand").mockReturnValue(null);

        // eslint-disable-next-line dot-notation
        (exclusionsAdd["handlePreHookCheck"] as jest.Mock).mockReturnValue(
            undefined
        );
        await exclusionsAdd.run();

        // eslint-disable-next-line dot-notation
        expect(exclusionsAdd["handlePreHookCheck"](commandArgvMock)).toEqual(undefined);
        expect(handleExclusionsAndDevelopmentCommandMock).toBeCalled();
    });

    it("should call the pre hook check and not execute the command if there are warnings", async () => {
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            argv: [
                "service-one"
            ]
        });
        const handleExclusionsAndDevelopmentCommandMock = jest.spyOn(exclusionsAdd as any, "handleExclusionsAndDevelopmentCommand").mockReturnValue(null);

        // eslint-disable-next-line dot-notation
        (exclusionsAdd["handlePreHookCheck"] as jest.Mock).mockReturnValue(
            "Warnings"
        );

        await exclusionsAdd.run();

        // eslint-disable-next-line dot-notation
        expect(exclusionsAdd["handlePreHookCheck"](commandArgvMock)).toEqual("Warnings");
        expect(handleExclusionsAndDevelopmentCommandMock).not.toBeCalled();
    });
});
