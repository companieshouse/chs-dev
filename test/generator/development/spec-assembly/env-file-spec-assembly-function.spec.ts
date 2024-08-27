import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec";
import { services } from "../../../utils/data";
import envFileSpecAssemblyFunction from "../../../../src/generator/development/spec-assembly/env-file-assembly-function";
import { expect } from "@jest/globals";
import { generateServiceSpec } from "../../../utils/docker-compose-spec";
import { join } from "path";

describe("envFileAssemblyFunction", () => {

    const service = services[5];
    const projectPath = "/home/test/projects/dockproj";

    beforeEach(() => {
        service.source = join(projectPath, `services/modules/${service.module}/${service.name}.docker-compose.yaml`);
    });

    it("does not add env_file when not specified in input", () => {
        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        envFileSpecAssemblyFunction(
            developmentDockerComposeSpec, {
                projectPath,
                service,
                serviceDockerComposeSpec: generateServiceSpec(service),
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v2",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec.services[service.name].env_file).toBeUndefined();
    });

    it("adds adjusted env_file when a string", () => {
        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        const serviceSpecWithStringEnvFile = generateServiceSpec(service);
        serviceSpecWithStringEnvFile.services[service.name].env_file = "./service.env";

        envFileSpecAssemblyFunction(
            developmentDockerComposeSpec, {
                projectPath: "/home/test/projects/dockproj",
                service,
                serviceDockerComposeSpec: serviceSpecWithStringEnvFile,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v2",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec.services[service.name].env_file).toEqual(
            `../../services/modules/${service.module}/service.env`
        );
    });

    it("adds adjusted env_file when a string array", () => {
        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        const serviceSpecWithStringArrayEnvFile = generateServiceSpec(service);
        serviceSpecWithStringArrayEnvFile.services[service.name].env_file = [
            "./service.env",
            "./service-23.env"
        ];

        envFileSpecAssemblyFunction(
            developmentDockerComposeSpec, {
                projectPath: "/home/test/projects/dockproj",
                service,
                serviceDockerComposeSpec: serviceSpecWithStringArrayEnvFile,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v2",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec.services[service.name].env_file).toEqual(
            [
                `../../services/modules/${service.module}/service.env`,
                `../../services/modules/${service.module}/service-23.env`
            ]
        );
    });
});
