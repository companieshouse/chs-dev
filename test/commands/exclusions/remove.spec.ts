import { expect, jest } from "@jest/globals";
import Remove from "../../../src/commands/exclusions/remove";
import { services } from "../../utils/data";

const removeExclusionForServiceMock = jest.fn();

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
                removeExclusionForService: removeExclusionForServiceMock
            };
        }
    };
});

describe("exclusions remove", () => {
    const runHookMock = jest.fn();

    let exclusionsRemove;
    let parseMock;

    beforeEach(() => {
        jest.resetAllMocks();

        exclusionsRemove = new Remove(
            [], {
                // @ts-expect-error
                runHook: runHookMock
            }
        );

        parseMock = jest.spyOn(exclusionsRemove, "parse");
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

            await expect(exclusionsRemove.run()).rejects.toEqual(expect.any(Error));
        });
    }

    it("removes exclusion for valid service", async () => {
        parseMock.mockResolvedValue({
            args: {
                service: "service-one"
            },
            argv: [
                "service-one"
            ]
        });

        await exclusionsRemove.run();

        expect(removeExclusionForServiceMock).toHaveBeenCalledWith("service-one");
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

        await exclusionsRemove.run();

        expect(runHookMock).toHaveBeenCalledWith(
            "generate-runnable-docker-compose", {}
        );
    });
});
