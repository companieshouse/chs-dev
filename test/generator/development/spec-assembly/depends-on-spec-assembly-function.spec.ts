import { expect } from "@jest/globals";
import dependsOnSpecAssemblyFunction from "../../../../src/generator/development/spec-assembly/depends-on-spec-assembly-function";
import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec";
import { services } from "../../../utils/data";
import { generateServiceSpec } from "../../../utils/docker-compose-spec";

describe("dependsOnSpecAssemblyFunction", () => {

    it("adds dependencies to development spec from service spec", () => {
        const service = services[6];
        const serviceSpec = generateServiceSpec(service);
        serviceSpec.services[service.name].depends_on = {
            "service-one": {
                condition: "service_healthy"
            },
            "service-two": {
                condition: "service_healthy"
            }
        };

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {
                    depends_on: {
                        [`${service.name}-builder`]: {
                            condition: "service_completed_succcessfully",
                            restart: true
                        }
                    }
                }
            }
        };

        dependsOnSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath: "/home/test/project",
                serviceDockerComposeSpec: serviceSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(Array.isArray(developmentDockerComposeSpec.services[service.name].depends_on)).toBe(false);
        expect(developmentDockerComposeSpec.services[service.name].depends_on || {}).toMatchSnapshot();
    });

    it("converts from array", () => {
        const service = services[6];
        const serviceSpec = generateServiceSpec(service);
        serviceSpec.services[service.name].depends_on = [
            "service-three",
            "service-five"
        ];

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {
                    depends_on: {
                        [`${service.name}-builder`]: {
                            condition: "service_completed_succcessfully",
                            restart: true
                        }
                    }
                }
            }
        };

        dependsOnSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath: "/home/test/project",
                serviceDockerComposeSpec: serviceSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(Array.isArray(developmentDockerComposeSpec.services[service.name].depends_on)).toBe(false);
        expect(developmentDockerComposeSpec.services[service.name].depends_on || {}).toMatchSnapshot();
    });

    it("does not modify depends_on when not present in service spec", () => {
        const service = services[0];
        const serviceSpec = generateServiceSpec(service);

        serviceSpec.services[service.name].depends_on = undefined;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        dependsOnSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath: "/home/test/project",
                serviceDockerComposeSpec: serviceSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(Object.keys(developmentDockerComposeSpec.services[service.name])).not.toContain("depends_on");
    });

});
