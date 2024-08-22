import { afterAll, beforeAll, expect, jest } from "@jest/globals";

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { DockerComposeFileGenerator } from "../../src/generator/docker-compose-file-generator";
import { Service } from "../../src/model/Service";
import { join, resolve } from "path";
import { parse, stringify } from "yaml";
import { getBuilder as getBuilderMock } from "../../src/state/builders";
import { generateServiceSpec } from "../utils/docker-compose-spec";
import DevelopmentDockerComposeFactory from "../../src/generator/development/development-docker-compose-factory";
import { DockerComposeSpec } from "../../src/model/DockerComposeSpec";

const developmentDockerComposeSpecFactoryMock = {
    create: jest.fn()
};

jest.mock("../../src/state/builders");
jest.mock("../../src/generator/development/development-docker-compose-factory");

describe("DockerComposeFileGenerator", () => {
    let tempDir: string;
    let moduleDir: string;
    let dockerComposeFileGenerator: DockerComposeFileGenerator;

    beforeAll(() => {
        tempDir = resolve(mkdtempSync("docker-compose-file-gen"));
        moduleDir = join(tempDir, "services/modules/module-one");

        mkdirSync(join(tempDir, "local"));
        mkdirSync(moduleDir, { recursive: true });
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        dockerComposeFileGenerator = new DockerComposeFileGenerator(resolve(tempDir));
        mkdirSync(join(tempDir, "services/infrastructure/"), { recursive: true });

        copyFileSync(
            join(process.cwd(), "test/data/docker-compose-file-generator/docker-compose.yaml"),
            join(tempDir, "services/infrastructure/docker-compose.yaml")
        );
    });

    describe("generateDockerComposeFile", () => {

        const services: (Service & {
            liveUpdate: boolean
        })[] = [
            {
                name: "service-one",
                module: "module-one",
                source: "services/modules/module-one/service-one.docker-compose.yaml",
                dependsOn: [],
                builder: "java",
                metadata: {
                    ingressRoute: "Path('One')"
                },
                repository: null,
                liveUpdate: false
            },
            {
                name: "service-two",
                module: "module-one",
                source: "services/modules/module-one/service-two.docker-compose.yaml",
                dependsOn: [],
                builder: "node",
                metadata: {
                    ingressRoute: "Path(\"two\")"
                },
                repository: null,
                liveUpdate: false
            },
            {
                name: "service-three",
                module: "module-two",
                source: "services/modules/module-two/service-three.docker-compose.yaml",
                dependsOn: [],
                builder: "repository",
                metadata: {},
                repository: null,
                liveUpdate: true
            },
            {
                name: "service-four",
                module: "module-three",
                source: "services/modules/module-three/service-four.docker-compose.yaml",
                dependsOn: [],
                builder: "",
                metadata: {
                    ingressRoute: "Path(\"four\")",
                    healthcheck: "ping me"
                },
                repository: null,
                liveUpdate: true
            },
            {
                name: "service-five",
                module: "module-one",
                source: "services/modules/module-one/service-five.docker-compose.yaml",
                dependsOn: [],
                builder: "java",
                metadata: {
                    languageMajorVersion: "17"
                },
                repository: null,
                liveUpdate: false
            },
            {
                name: "service-six",
                module: "module-one",
                source: "services/modules/module-one/service-six.docker-compose.yaml",
                dependsOn: [],
                builder: "node",
                metadata: {
                    languageMajorVersion: "18",
                    ingressRoute: "Path(\"six\")"
                },
                repository: null,
                liveUpdate: false
            },
            {
                name: "service-nine",
                module: "module-one",
                source: "services/modules/module-one/service-nine.docker-compose.yaml",
                dependsOn: [],
                builder: "node",
                metadata: {
                    languageMajorVersion: "18",
                    ingressRoute: "Path(\"nine\")",
                    entrypoint: "docker_start.sh",
                    buildOutputDir: "out/"
                },
                repository: null,
                liveUpdate: false
            },
            {
                name: "service-seven",
                module: "module-two",
                source: "services/modules/module-two/service-seven.docker-compose.yaml",
                dependsOn: [],
                builder: "repository",
                metadata: {
                    repoContext: "tilt/",
                    ingressRoute: "Path(\"my-route\")"
                },
                repository: null,
                liveUpdate: true
            },
            {
                name: "service-eight",
                module: "module-two",
                source: "services/modules/module-two/service-eight.docker-compose.yaml",
                dependsOn: [],
                builder: "repository",
                metadata: {
                    repoContext: "tilt/",
                    ingressRoute: "Path(\"my-route\")",
                    healthcheck: "curl http://localhost"
                },
                repository: null,
                liveUpdate: true
            }
        ];

        it("correctly generates docker compose file, no exclusions", () => {
            dockerComposeFileGenerator.generateDockerComposeFile(
                services, []
            );

            const dockerComposeOutputFile = join(tempDir, "docker-compose.yaml");
            expect(existsSync(dockerComposeOutputFile)).toBe(true);

            const dockerComposeOutput = parse(readFileSync(dockerComposeOutputFile).toString("utf8"));

            dockerComposeOutput.include = dockerComposeOutput.include.map(
                (inclusion: string) => inclusion.replace(tempDir, ".")
            );

            expect(dockerComposeOutput).toMatchSnapshot();
        });

        it("correctly excludes services", () => {
            dockerComposeFileGenerator.generateDockerComposeFile(
                services, [
                    "service-five",
                    "service-six",
                    "service-seven"
                ]
            );

            const dockerComposeOutputFile = join(tempDir, "docker-compose.yaml");
            expect(existsSync(dockerComposeOutputFile)).toBe(true);

            const dockerComposeOutput = parse(readFileSync(dockerComposeOutputFile).toString("utf8"));

            dockerComposeOutput.include = dockerComposeOutput.include.map(
                (inclusion: string) => inclusion.replace(tempDir, ".")
            );

            expect(dockerComposeOutput).toMatchSnapshot();
        });
    });

    describe("generateDevelopmentServiceDockerComposeFile without builderVersion", () => {
        let serviceDockerComposeFile: string;

        beforeEach(() => {
            serviceDockerComposeFile = join(moduleDir, "service.docker-compose.yaml");

            copyFileSync(
                join(process.cwd(), "test/data/docker-compose-file-generator/service.docker-compose.yaml"),
                serviceDockerComposeFile
            );

            rmSync(
                join(tempDir, "local/service-one"),
                {
                    force: true,
                    recursive: true
                }
            );

            // @ts-expect-error
            DevelopmentDockerComposeFactory.mockReturnValue(
                developmentDockerComposeSpecFactoryMock
            );
        });

        it("gets builder for request", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=node"
            ];

            writeFileSync(
                serviceDockerComposeFile,
                stringify(initialServiceDefinition),
                {
                    flag: "w"
                }
            );

            const service: Service = {
                name: "service-one",
                module: "module-one",
                source: serviceDockerComposeFile,
                repository: null,
                dependsOn: [],
                builder: "node",
                metadata: {}
            };

            const generatedDevDockerCompSpec: DockerComposeSpec = generateServiceSpec(service);
            generatedDevDockerCompSpec.services[service.name].labels = [
                // @ts-expect-error
                ...generatedDevDockerCompSpec.services[service.name].labels,
                "test.output=true"
            ];

            developmentDockerComposeSpecFactoryMock.create.mockReturnValue(
                generatedDevDockerCompSpec
            );

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service, undefined);

            expect(getBuilderMock).toHaveBeenCalledWith(
                resolve(tempDir), "node", undefined
            );
        });

        it("generates docker compose spec using factory", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=node"
            ];

            const builderSpec = {
                name: "node",
                version: "v3",
                builderSpec: "SPEC"
            };

            // @ts-expect-error
            getBuilderMock.mockReturnValue(builderSpec);

            writeFileSync(
                serviceDockerComposeFile,
                stringify(initialServiceDefinition),
                {
                    flag: "w"
                }
            );

            const service: Service = {
                name: "service-one",
                module: "module-one",
                source: serviceDockerComposeFile,
                repository: null,
                dependsOn: [],
                builder: "node",
                metadata: {}
            };

            const generatedDevDockerCompSpec: DockerComposeSpec = generateServiceSpec(service);
            generatedDevDockerCompSpec.services[service.name].labels = [
                ...generatedDevDockerCompSpec.services[service.name].labels,
                "test.output=true"
            ];

            developmentDockerComposeSpecFactoryMock.create.mockReturnValue(
                generatedDevDockerCompSpec
            );

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service, undefined);

            expect(developmentDockerComposeSpecFactoryMock.create).toHaveBeenCalledWith(
                initialServiceDefinition,
                service
            );

            expect(DevelopmentDockerComposeFactory).toHaveBeenCalledWith(
                builderSpec, resolve(tempDir)
            );
        });

        it("writes out generated docker compose", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=node"
            ];

            const builderSpec = {
                name: "node",
                version: "v3",
                builderSpec: "SPEC"
            };

            // @ts-expect-error
            getBuilderMock.mockReturnValue(builderSpec);

            writeFileSync(
                serviceDockerComposeFile,
                stringify(initialServiceDefinition),
                {
                    flag: "w"
                }
            );

            const service: Service = {
                name: "service-one",
                module: "module-one",
                source: serviceDockerComposeFile,
                repository: null,
                dependsOn: [],
                builder: "node",
                metadata: {}
            };

            const generatedDevDockerCompSpec: DockerComposeSpec = { ...initialServiceDefinition };
            generatedDevDockerCompSpec.services[service.name].labels = [
                ...generatedDevDockerCompSpec.services[service.name].labels,
                "generated=true"
            ];

            developmentDockerComposeSpecFactoryMock.create.mockReturnValue(
                generatedDevDockerCompSpec
            );

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service, undefined);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));
            expect(generatedDockerCompose).toEqual(
                generatedDevDockerCompSpec
            );
        });

        it("creates touch file", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=node"
            ];

            const builderSpec = {
                name: "node",
                version: "v3",
                builderSpec: "SPEC"
            };

            // @ts-expect-error
            getBuilderMock.mockReturnValue(builderSpec);

            writeFileSync(
                serviceDockerComposeFile,
                stringify(initialServiceDefinition),
                {
                    flag: "w"
                }
            );

            const service: Service = {
                name: "service-one",
                module: "module-one",
                source: serviceDockerComposeFile,
                repository: null,
                dependsOn: [],
                builder: "node",
                metadata: {}
            };

            const generatedDevDockerCompSpec: DockerComposeSpec = { ...initialServiceDefinition };
            generatedDevDockerCompSpec.services[service.name].labels = [
                ...generatedDevDockerCompSpec.services[service.name].labels,
                "generated=true"
            ];

            developmentDockerComposeSpecFactoryMock.create.mockReturnValue(
                generatedDevDockerCompSpec
            );

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service, undefined);

            const touchFile = join(resolve(tempDir), "local", service.name, ".touch");

            expect(existsSync(touchFile)).toBe(true);
        });
    });
});
