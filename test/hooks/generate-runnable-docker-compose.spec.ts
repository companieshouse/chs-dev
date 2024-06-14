import { beforeAll, expect, jest } from "@jest/globals";
import { Service } from "../../src/state/inventory";
import { State } from "../../src/state/state-manager";
import { join } from "path";
import { readFileSync } from "fs";
import { Hook } from "@oclif/core";

let snapshot;

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot
            };
        }
    };
});

describe("Hook: generate-runnable-docker-compose", () => {

    const generateDockerComposeFileMock =
        jest.fn();

    const generateTilefileMock = jest.fn();

    const inventoryServicesFindMock = jest.fn();

    const testConfig = {
        root: "./",
        configDir: "/users/user/.config/chs-dev/"
    };

    let services: Service[];

    jest.mock("../../src/generator/docker-compose-file-generator", () => {
        return {
            DockerComposeFileGenerator: function () {
                return {
                    generateDockerComposeFile: generateDockerComposeFileMock
                };
            }
        };
    });

    jest.mock("../../src/generator/tiltfile-generator", () => {
        return {
            TiltfileGenerator: function () {
                return {
                    generate: generateTilefileMock
                };
            }
        };
    });

    jest.mock("../../src/state/inventory", () => {
        return {
            Inventory: function () {
                return {
                    services,
                    modules: services.map(service => ({ name: service.module }))
                };
            }
        };
    });

    let generateRunnableDockerComposeHook: Hook<"generate-runnable-docker-compose">;

    const expectDockerComposeCalledForServices = (serviceNames: string[], servicesInLiveUpdate: string[] = [], excludedServices: string[] = []) => {
        const generateDockerComposeCall = generateDockerComposeFileMock.mock.calls[0];

        const expectedServices = serviceNames
            .map(serviceName => services.find(service => service.name === serviceName))
            .filter(service => typeof service !== "undefined" && service !== null)
            .map(service => ({
                ...service,
                // @ts-expect-error
                liveUpdate: servicesInLiveUpdate.includes(service.name)
            }));

        expect(generateDockerComposeCall[0]).toHaveLength(expectedServices.length);

        for (const expectedService of expectedServices) {
            expect(generateDockerComposeCall[0]).toContainEqual(expectedService);
        }

        expect(generateDockerComposeCall[1]).toEqual(excludedServices);
    };

    beforeAll(() => {
        const servicesTestDataFile = join(process.cwd(), "test/data/generate-runnable-docker-compose-hook/services.json");

        services = JSON.parse(readFileSync(servicesTestDataFile).toString("utf8"));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("no excluded services, not in development mode, one dependency", () => {
        const expectedServicesEnabled = ["service-four", "service-one"];

        beforeEach(async () => {
            jest.resetAllMocks();

            // @ts-expect-error
            generateRunnableDockerComposeHook = (await import("../../src/hooks/generate-runnable-docker-compose")).hook;

            snapshot = {
                modules: [],
                services: [
                    "service-four"
                ],
                servicesWithLiveUpdate: [],
                excludedFiles: []
            };
        });

        it("generates docker compose file including the expected services", async () => {
            // @ts-expect-error
            await generateRunnableDockerComposeHook({
                config: testConfig,
                context: jest.fn()
            });

            expect(generateDockerComposeFileMock).toHaveBeenCalledTimes(1);

            expectDockerComposeCalledForServices(
                expectedServicesEnabled
            );
        });

        it("generates tilt file", async () => {
            // @ts-expect-error
            await generateRunnableDockerComposeHook({
                config: testConfig,
                context: jest.fn()
            });

            expect(generateTilefileMock).toHaveBeenCalledTimes(1);

            const generateTiltfileCall = generateTilefileMock.mock.calls[0];

            const expectedServices = expectedServicesEnabled.map(serviceName => services.find(service => service.name === serviceName));

            expect(generateTiltfileCall[0]).toHaveLength(expectedServices.length);

            for (const expectedService of expectedServices) {
                expect(generateTiltfileCall[0]).toContainEqual({
                    ...expectedService,
                    liveUpdate: false
                });
            }

            expect(generateTiltfileCall[1]).toEqual([]);
        });
    });

    describe("enabled module with dependencies on others, none in dev", () => {
        const expectedServicesEnabled = ["service-five", "service-four", "service-three", "service-two", "service-one"];

        beforeEach(async () => {
            jest.resetAllMocks();

            // @ts-expect-error
            generateRunnableDockerComposeHook = (await import("../../src/hooks/generate-runnable-docker-compose")).hook;

            snapshot = {
                modules: ["module-three"],
                services: [],
                servicesWithLiveUpdate: [],
                excludedFiles: []
            };
        });

        it("generates docker compose file", async () => {
            // @ts-expect-error
            await generateRunnableDockerComposeHook({
                config: testConfig,
                context: jest.fn()
            });

            expect(generateDockerComposeFileMock).toHaveBeenCalledTimes(1);

            expectDockerComposeCalledForServices(
                expectedServicesEnabled
            );
        });
    });

    describe("enabled service and module no dependencies, no live update", () => {
        const expectedServicesEnabled = ["service-eight", "service-nine"];

        beforeEach(async () => {
            jest.resetAllMocks();

            // @ts-expect-error
            generateRunnableDockerComposeHook = (await import("../../src/hooks/generate-runnable-docker-compose")).hook;

            snapshot = {
                modules: ["module-six"],
                services: ["service-eight"],
                servicesWithLiveUpdate: [],
                excludedFiles: []
            };
        });

        it("only has service-eight and service-nine", async () => {
            // @ts-expect-error
            await generateRunnableDockerComposeHook({
                config: testConfig,
                context: jest.fn()
            });

            expect(generateDockerComposeFileMock).toHaveBeenCalledTimes(1);

            expectDockerComposeCalledForServices(
                expectedServicesEnabled
            );
        });
    });

    describe("services in development mode", () => {

        beforeEach(async () => {
            jest.resetAllMocks();

            // @ts-expect-error
            generateRunnableDockerComposeHook = (await import("../../src/hooks/generate-runnable-docker-compose")).hook;

            snapshot = {
                modules: [],
                services: ["service-one", "service-two", "service-three"],
                servicesWithLiveUpdate: ["service-two", "service-three"],
                excludedFiles: []
            };
        });

        it("generates docker compose file", async () => {
            // @ts-expect-error
            await generateRunnableDockerComposeHook({
                config: testConfig,
                context: jest.fn()
            });

            expect(generateDockerComposeFileMock).toHaveBeenCalledTimes(1);

            expectDockerComposeCalledForServices(
                ["service-one", "service-two", "service-three"],
                ["service-two", "service-three"]
            );
        });
    });

    describe("excluded service", () => {

        beforeEach(async () => {
            jest.resetAllMocks();

            // @ts-expect-error
            generateRunnableDockerComposeHook = (await import("../../src/hooks/generate-runnable-docker-compose")).hook;

            snapshot = {
                modules: [],
                services: ["service-five"],
                servicesWithLiveUpdate: [],
                excludedFiles: ["service-two"]
            };
        });

        it("generates docker compose file", async () => {
            // @ts-expect-error
            await generateRunnableDockerComposeHook({
                config: testConfig,
                context: jest.fn()
            });

            expect(generateDockerComposeFileMock).toHaveBeenCalledTimes(1);

            expectDockerComposeCalledForServices(
                ["service-five", "service-one", "service-two", "service-three"],
                [],
                ["service-two"]
            );
        });
    });
});
