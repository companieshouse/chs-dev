import { expect } from "@jest/globals";
import { volumeSpecAssemblyFunction } from "../../../../src/generator/development/spec-assembly/volume-spec-assembly-function";
import { services } from "../../../utils/data";
import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec";

describe("volumeSpecAssemblyFunction", () => {

    it("formats volumes in short format without access mode", () => {
        const service = services[1];

        const projectPath = `/Users/tester/project/`;

        service.source =
            `${projectPath}/services/modules/${service.module}/` +
                `${service.name}.docker-compose.yaml`;

        const developmentDockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        const serviceDockerComposeSpec = {
            services: {
                [service.name]: {
                    volumes: [
                        "my-vol:/var/vol",
                        "../another-vol:/var/volb"
                    ]
                }
            }
        };

        volumeSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath,
                serviceDockerComposeSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec).toEqual({
            services: {
                [service.name]: {
                    volumes: [
                        "my-vol:/var/vol",
                        `../../services/modules/another-vol:/var/volb`
                    ]
                }
            }
        });
    });

    it("formats volumes in short format with access modes", () => {
        const service = services[1];

        const projectPath = `/Users/tester/project/`;

        service.source =
            `${projectPath}/services/modules/${service.module}/` +
                `${service.name}.docker-compose.yaml`;

        const developmentDockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        const serviceDockerComposeSpec = {
            services: {
                [service.name]: {
                    volumes: [
                        "my-vol:/var/vol:z",
                        "../another-vol:/var/volb:ro"
                    ]
                }
            }
        };

        volumeSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath,
                serviceDockerComposeSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec).toEqual({
            services: {
                [service.name]: {
                    volumes: [
                        "my-vol:/var/vol:z",
                        `../../services/modules/another-vol:/var/volb:ro`
                    ]
                }
            }
        });
    });

    it("formats bind volumes in long format only", () => {
        const service = services[1];

        const projectPath = `/Users/tester/project/`;

        service.source =
            `${projectPath}/services/modules/${service.module}/` +
                `${service.name}.docker-compose.yaml`;

        const developmentDockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        const serviceDockerComposeSpec = {
            services: {
                [service.name]: {
                    volumes: [
                        {
                            type: "bind",
                            source: "volumes/vol-one",
                            target: "/var/volumes/one"
                        },
                        {
                            type: "bind",
                            source: "../module-three/volumes/vol-two",
                            target: "/var/volumes/two"
                        },
                        {
                            type: "volume",
                            source: "db-data",
                            target: "/data",
                            volume: {}
                        }
                    ]
                }
            }
        };

        volumeSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath,
                serviceDockerComposeSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec).toEqual({
            services: {
                [service.name]: {
                    volumes: [
                        {
                            type: "bind",
                            source: `../../services/modules/${service.module}/volumes/vol-one`,
                            target: "/var/volumes/one"
                        },
                        {
                            type: "bind",
                            source: "../../services/modules/module-three/volumes/vol-two",
                            target: "/var/volumes/two"
                        },
                        {
                            type: "volume",
                            source: "db-data",
                            target: "/data",
                            volume: {}
                        }
                    ]
                }
            }
        });
    });

    it("does not add volume when service does not have volume", () => {
        const service = services[1];

        const projectPath = `/Users/tester/project/`;

        service.source =
            `${projectPath}/services/modules/${service.module}/` +
                `${service.name}.docker-compose.yaml`;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        const serviceDockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        volumeSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath,
                serviceDockerComposeSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec.services[service.name].volumes).toBe(undefined);
    });

    it("merges builder volumes and lets service override targets", () => {
        const service = services[1];

        const projectPath = `/Users/tester/project`;

        service.source =
            `${projectPath}/services/modules/${service.module}/` +
                `${service.name}.docker-compose.yaml`;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {
                    volumes: [
                        `${projectPath}/repositories/${service.name}:/app`,
                        "/builder-cache:/tmp/cache"
                    ]
                }
            }
        };

        const serviceDockerComposeSpec = {
            services: {
                [service.name]: {
                    volumes: [
                        "/var/run/docker.sock:/var/run/docker.sock",
                        "/custom/app:/app"
                    ]
                }
            }
        };

        volumeSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath,
                serviceDockerComposeSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec.services[service.name].volumes).toEqual([
            "/builder-cache:/tmp/cache",
            "/var/run/docker.sock:/var/run/docker.sock",
            "/custom/app:/app"
        ]);
    });

    it("keeps named volumes unchanged", () => {
        const service = services[1];

        const projectPath = `/Users/tester/project`;

        service.source =
            `${projectPath}/services/modules/${service.module}/` +
                `${service.name}.docker-compose.yaml`;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        const serviceDockerComposeSpec = {
            services: {
                [service.name]: {
                    volumes: [
                        "db-data:/var/lib/postgres",
                        "logs:/var/log/app"
                    ]
                }
            }
        };

        volumeSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                service,
                projectPath,
                serviceDockerComposeSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec.services[service.name].volumes).toEqual([
            "db-data:/var/lib/postgres",
            "logs:/var/log/app"
        ]);
    });
});
