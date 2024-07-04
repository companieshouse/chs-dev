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
                addExclusionForService: addExclusionForServiceMock
            };
        }
    };
});

describe("exclusions add", () => {
    const runHookMock = jest.fn();

    let exclusionsAdd;
    let parseMock;

    beforeEach(() => {
        jest.resetAllMocks();

        exclusionsAdd = new Add(
            [], {
                // @ts-expect-error
                runHook: runHookMock
            }
        );

        parseMock = jest.spyOn(exclusionsAdd, "parse");
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
});
