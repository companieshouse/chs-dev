import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec.js";
import { services } from "../../../utils/data.js";
import { generateBuilderSpec, generateServiceSpec } from "../../../utils/docker-compose-spec.js";

import nonServiceTlaSpecAssemblyFunction from "../../../../src/generator/development/spec-assembly/non-services-tla-spec-assembly-function.js";
import { expect } from "@jest/globals";

describe("nonServiceTlaSpecAssemblyFunction", () => {

    it("applies non-services attributes from source service to development spec", () => {
        const service = services[0];
        const serviceSpec: DockerComposeSpec = {
            ...generateServiceSpec(service),
            networks: {
                "network-one": {},
                "network-two": {
                    "some-attribute": "foobar"
                }
            },
            volumes: {
                "vol-one": {
                    external: true
                }
            },
            secrets: {
                secretOne: {
                    environment: "Secret"
                }
            },
            include: [
                "file.docker.compose.yaml"
            ]
        };

        const developmentDockerComposeSpec = {
            services: {
                [service.name]: {
                    labels: [
                        "label.one.value=foobar"
                    ]
                }
            }
        };

        nonServiceTlaSpecAssemblyFunction(
            developmentDockerComposeSpec,
            {
                projectPath: "/tmp/project",
                service,
                serviceDockerComposeSpec: serviceSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v2",
                    builderSpec: generateBuilderSpec(
                        "local/builders/java/v2", true
                    )
                }
            }
        );

        expect(Object.keys(developmentDockerComposeSpec).sort()).toEqual([
            "networks",
            "secrets",
            "services",
            "volumes",
            "include"
        ].sort());

        expect(developmentDockerComposeSpec.services[service.name].labels).toEqual([
            "label.one.value=foobar"
        ]);
    });
});
