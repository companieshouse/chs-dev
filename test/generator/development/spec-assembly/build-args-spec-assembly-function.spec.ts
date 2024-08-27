import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec";
import { services } from "../../../utils/data";
import { generateServiceSpec } from "../../../utils/docker-compose-spec";
import buildArgsSpecAssemblyFunction from "../../../../src/generator/development/spec-assembly/build-args-spec-assembly-function";
import { expect } from "@jest/globals";

const buildArgTestCases: [Record<string, string>, Record<string, string>][] = [
    [
        {
            LANGUAGE_MAJOR_VERSION: "21"
        },
        {
            languageMajorVersion: "21"
        }
    ],
    [
        {
            ENTRYPOINT: "bin/entry.sh"
        },
        {
            entrypoint: "bin/entry.sh"
        }
    ],
    [
        {
            OUTDIR: "out/"
        },
        {
            buildOutputDir: "out/"
        }
    ],
    [
        {
            LANGUAGE_MAJOR_VERSION: "21",
            ENTRYPOINT: "bin/entry.sh",
            OUTDIR: "out/"
        },
        {
            languageMajorVersion: "21",
            entrypoint: "bin/entry.sh",
            buildOutputDir: "out/"
        }
    ]
];

describe("buildArgsSpecAssemblyFunction", () => {

    beforeEach(() => {
        delete process.env.SSH_PRIVATE_KEY_PASSPHRASE;
    });

    for (const [expectedBuildArgs, serviceMetadata] of buildArgTestCases) {
        it("adds build args to each build", () => {
            const service = services[3];
            service.metadata = serviceMetadata;

            const serviceSpec = generateServiceSpec(service);

            const developmentDockerComposeSpec: DockerComposeSpec = {
                services: {
                    [`${service.name}-builder`]: {
                        build: {
                            dockerfile: "local/builders/java/v2/build.Dockerfile"
                        }
                    },
                    [service.name]: {
                        build: {
                            dockerfile: "local/builders/java/v2/Dockerfile"
                        }
                    }
                }
            };

            buildArgsSpecAssemblyFunction(developmentDockerComposeSpec, {
                service,
                projectPath: "/home/test",
                serviceDockerComposeSpec: serviceSpec,
                builderDockerComposeSpec: {
                    name: "java",
                    version: "v2",
                    builderSpec: ""
                }
            });

            // @ts-expect-error
            expect(developmentDockerComposeSpec.services[service.name].build.args).toEqual(expectedBuildArgs);
            // @ts-expect-error
            expect(developmentDockerComposeSpec.services[`${service.name}-builder`].build.args).toEqual(expectedBuildArgs);
        });
    }
});
