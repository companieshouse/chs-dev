import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import ExclusionDockerComposeSpecFactory from "../../../src/generator/exclusion/exclusion-docker-compose-factory";
import { readFileSync } from "fs";
import yaml from "yaml";
import { DockerComposeSpec } from "../../../src/model/DockerComposeSpec";

jest.mock("fs");
jest.mock("yaml");

describe("ExclusionDockerComposeSpecFactory", () => {
    let factory;
    beforeEach(() => {
        factory = new ExclusionDockerComposeSpecFactory();
    });

    describe("handleExcludedServices", () => {
        it("should return all services when excluded list is empty", () => {
            const services = [{ name: "serviceA", module: "app", source: "path/to/serviceA" }];
            const result = factory.handleExcludedServices(services, []);
            expect(result.runnableServices).toEqual(services);
            expect(result.infrastructureSources).toEqual([]);
        });

        it("should remove excluded services and handle infrastructural services", () => {
            const services = [
                { name: "serviceA", module: "app", source: "path/to/serviceA" },
                { name: "serviceB", module: "infrastructure", source: "path/to/serviceB" }
            ];
            const result = factory.handleExcludedServices(services, ["serviceA"]);
            expect(result.runnableServices).toEqual([]);
            expect(result.infrastructureSources).toEqual(["path/to/serviceB"]);
        });
    });

    describe("generateDockerComposeFileForExclusionRunnableServices", () => {
        it("should generate correct compose file paths and content", () => {
            const service = { name: "serviceA", source: "path/to/serviceA.yaml" };
            const mockYaml = { services: { serviceA: { depends_on: [] } } };
            (readFileSync as jest.Mock).mockReturnValue(
                JSON.stringify("mock file content")
            );
            (yaml.parse as jest.Mock).mockReturnValue(
                mockYaml
            );
            (yaml.stringify as jest.Mock).mockReturnValue(
                "yaml content"
            );

            const result = factory.generateDockerComposeFileForExclusionRunnableServices(service, ["serviceB"]);
            expect(result.runnableServicesComposeFile).toBe("exclusion-runnable-services/serviceA.docker-compose.yaml");
            expect(result.updatedYamlContent).toBe("yaml content");
        });
    });

    describe("removeExcludedServiceFromDependOn", () => {
        it("should remove excluded services from depends_on property", () => {
            const mockCompose: DockerComposeSpec = {
                services: {
                    serviceA: { depends_on: ["serviceB", "serviceC"] }
                }
            };

            const result = factory.removeExcludedServiceFromDependOn(mockCompose, ["serviceB"]);
            expect(result.services.serviceA.depends_on).toEqual(["serviceC"]);
        });

        it("should remove empty depends_on property", () => {
            const mockCompose: DockerComposeSpec = {
                services: {
                    serviceA: { depends_on: ["serviceB"] }
                }
            };

            const result = factory.removeExcludedServiceFromDependOn(mockCompose, ["serviceB"]);
            expect(result.services.serviceA.depends_on).toBeUndefined();
        });
    });

    describe("handleInfrastructuralServices", () => {
        it("should separate infrastructure services correctly", () => {
            const services = [
                { name: "serviceA", module: "app", source: "path/to/serviceA" },
                { name: "serviceB", module: "infrastructure", source: "path/to/serviceB" }
            ];
            const result = factory.handleInfrastructuralServices(services);
            expect(result.runnableServices.length).toBe(1);
            expect(result.infrastructureSources).toContain("path/to/serviceB");
        });
    });

    describe("filterObjectDependencies", () => {
        it("should remove excluded dependencies from object format", () => {
            const dependsOn = { serviceA: {}, serviceB: {} };
            const result = factory.filterObjectDependencies(dependsOn, ["serviceB"]);
            expect(result).toEqual({ serviceA: {} });
        });
    });

    describe("filterArrayDependencies", () => {
        it("should remove excluded dependencies from array format", () => {
            const dependsOn = ["serviceA", "serviceB"];
            const result = factory.filterArrayDependencies(dependsOn, ["serviceB"]);
            expect(result).toEqual(["serviceA"]);
        });
    });
});
