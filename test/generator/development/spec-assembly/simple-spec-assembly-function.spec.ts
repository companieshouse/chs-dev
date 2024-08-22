import { expect } from "@jest/globals";
import { simpleSpecAssemblyFunctionFactory } from "../../../../src/generator/development/spec-assembly/simple-spec-assembly-function";
import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec";
import { services } from "../../../utils/data";

describe("simpleSpecAssemblyFunctionFactory", () => {

    const serviceSpec: DockerComposeSpec = {
        services: {
            "service-one": {
                labels: [
                    "label.one=value-one",
                    "label.two=value-two"
                ],
                image: "image",
                depends_on: []
            }
        }
    };

    let developmentSpec: DockerComposeSpec;

    beforeEach(() => {
        developmentSpec = {
            services: {
                "service-one": {},
                "service-one-builder": {}
            }
        };
    });

    it("adds property to development when present", () => {
        const assemblyFunction = simpleSpecAssemblyFunctionFactory("labels");

        assemblyFunction(developmentSpec, {
            serviceDockerComposeSpec: serviceSpec,
            projectPath: "",
            service: services[0],
            builderDockerComposeSpec: {
                name: "",
                version: "",
                builderSpec: ""
            }
        });

        expect(developmentSpec.services["service-one"].labels).toEqual(developmentSpec.services["service-one"].labels);
    });

    it("does not add property when not set in service spec", () => {
        const assemblyFunction = simpleSpecAssemblyFunctionFactory("environment");

        assemblyFunction(developmentSpec, {
            serviceDockerComposeSpec: serviceSpec,
            projectPath: "",
            service: services[0],
            builderDockerComposeSpec: {
                name: "",
                version: "",
                builderSpec: ""
            }
        });

        expect(Object.keys(developmentSpec.services["service-one"])).not.toContain("environment");
    });
});
