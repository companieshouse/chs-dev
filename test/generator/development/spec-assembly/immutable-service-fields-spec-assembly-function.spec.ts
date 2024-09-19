import { expect } from "@jest/globals";
import { createCompleteServiceSpecForServiceWithName } from "../../../utils/docker-compose-spec";
import { immutableServiceFieldsSpecAssemblyFunction } from "../../../../src/generator/development/spec-assembly/immutable-service-fields-spec-assembly-function";
import { services } from "../../../utils/data";

describe("immutableServiceFieldsSpecAssemblyFunction", () => {

    it("applies all attributes from service which are not in the mutable fields list", () => {
        const service = services[5];
        const serviceName = service.name;

        const serviceSpec = createCompleteServiceSpecForServiceWithName(serviceName);
        const developmentDockerComposeSpec = {
            services: {
                [serviceName]: {}
            }
        };

        const mutableFields = [
            "build",
            "develop",
            "env_file",
            "volumes",
            "depends_on",
            "secrets"
        ];

        const specAssemblyFunction = immutableServiceFieldsSpecAssemblyFunction(
            mutableFields
        );
        specAssemblyFunction(
            developmentDockerComposeSpec,
            {
                serviceDockerComposeSpec: serviceSpec,
                service,
                projectPath: "/user/test-user",
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v1",
                    builderSpec: ""
                }
            }
        );

        expect(developmentDockerComposeSpec.services[serviceName]).toMatchSnapshot();
    });
});
