import BuilderDockerComposeSpec from "../../../src/model/BuilderDockerComposeSpec";
import DevelopmentDockerComposeSpecFactory from "../../../src/generator/development/development-docker-compose-factory";

import { generateBuilderSpec, generateServiceSpec } from "../../utils/docker-compose-spec";
import { services } from "../../utils/data";
import { expect } from "@jest/globals";

const unmodifiableFieldTestCaseData = [
    // labels
    { labels: ["label.one=one", "label.two=two"] },
    {
        environment: {
            one: "one"
        }
    },
    {
        labels: {
            label: "one"
        },
        environment: [
            "one=one"
        ]
    }, {
        networks: ["chs"]
    }, {
        image: "123456.ecr.eu-west-2.amazonaws.com/repo"
    }, {
        image: "123456.ecr.eu-west-2.amazonaws.com/repo",
        labels: ["one=1", "two=2"],
        environment: {
            ENV_VAR: "yes"
        },
        networks: [
            "chs"
        ]
    },
    {
        healthcheck: {
            test: "echo hello"
        }
    }
];

describe("DevelopmentDockerComposeSpecFactory create", () => {

    const builderSpec: BuilderDockerComposeSpec = {
        name: "java",
        version: "v2",
        builderSpec: generateBuilderSpec("locals/builder/java/v2", true)
    };

    const projectPath = "/home/test-user/projects/docker-chs";

    let developmentDockerComposeSpecFactory: DevelopmentDockerComposeSpecFactory;

    beforeEach(() => {
        developmentDockerComposeSpecFactory = new DevelopmentDockerComposeSpecFactory(
            builderSpec, projectPath
        );
    });

    for (const testCase of unmodifiableFieldTestCaseData) {
        it(`adds unmodifiable field(s): ${Object.keys(testCase).join(", ")} to development service`, () => {
            const service = services[0];
            const serviceSpec = generateServiceSpec(service);

            serviceSpec.services[service.name] = {
                ...serviceSpec.services[service.name],
                ...testCase
            };

            const result = developmentDockerComposeSpecFactory.create(
                serviceSpec, service
            );

            for (const unmodifiableField of Object.keys(testCase)) {
                expect(result.services[service.name][unmodifiableField]).toBe(
                    testCase[unmodifiableField]
                );
            }
        });
    }

    it("adds builder service", () => {
        const service = services[6];
        const serviceSpec = generateServiceSpec(service);

        const result = developmentDockerComposeSpecFactory.create(
            serviceSpec, service
        );

        expect(result.services).toMatchSnapshot();
    });
});
