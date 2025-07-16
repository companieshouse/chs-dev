import { expect, jest } from "@jest/globals";
import Remove from "../../../src/commands/exclusions/remove";
import { services } from "../../utils/data";

const removeExclusionForServiceMock = jest.fn();
const getServiceDirectDependenciesMock = jest.fn();

jest.mock("./../../../src/run/service-loader", () => ({
    ServiceLoader: function () {
        return {
            getServiceDirectDependencies: getServiceDirectDependenciesMock,
            loadServicesNames: jest.fn().mockReturnValue(["service-one", "service-two", "service-three"])
        };
    }

}));

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
                removeExclusionForService: removeExclusionForServiceMock,
                snapshot: {
                    excludedServices: ["serviceA", "serviceB"]
                }
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
        getServiceDirectDependenciesMock.mockReturnValue(["dep1", "dep2"]);
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

    it("removes exclusion for dependencies of a service", async () => {
        const serviceName = "service-main";

        const logs = await exclusionsRemove.handleDependencyExclusion(serviceName);

        expect(getServiceDirectDependenciesMock).toHaveBeenCalledWith(serviceName);
        expect(removeExclusionForServiceMock).toHaveBeenCalledWith("dep1");
        expect(removeExclusionForServiceMock).toHaveBeenCalledWith("dep2");
        expect(logs[0]).toContain(`Removing"${serviceName}" and its dependencies from the exclusion list`);
        expect(logs).toContain("Service \"dep1\" is included (previous exclusion removed)");
        expect(logs).toContain("Service \"dep2\" is included (previous exclusion removed)");
    });

    it("logs when no dependencies are found for a service", async () => {
        getServiceDirectDependenciesMock.mockReturnValue([]);
        const serviceName = "service-main";

        const logs = await exclusionsRemove.handleDependencyExclusion(serviceName);
        expect(logs[0]).toBe(`No dependencies found for service "${serviceName}"`);
    });
});
