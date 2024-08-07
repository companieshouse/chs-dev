import { afterAll, beforeAll, expect } from "@jest/globals";

// @ts-expect-error does exist despite ts warning
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { DockerComposeFileGenerator } from "../../src/generator/docker-compose-file-generator";
import { Service } from "../../src/model/Service";
import { join, resolve } from "path";
import { parse, stringify } from "yaml";

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

    describe("generateDevelopmentServiceDockerComposeFile", () => {
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
        });

        it("creates development docker compose correctly for latest node service", () => {
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

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");
            generatedDockerCompose.services["service-one"].build.dockerfile = generatedDockerCompose.services["service-one"].build.dockerfile.replace(tempDir, ".");
            generatedDockerCompose.services["service-one"].build.args.REPO_PATH = generatedDockerCompose.services["service-one"].build.args.REPO_PATH.replace(tempDir, ".");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("creates development docker compose correctly node at specific major service", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=node",
                "chs.local.builder.languageVersion=18"
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
                metadata: {
                    languageMajorVersion: "18"
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");
            generatedDockerCompose.services["service-one"].build.dockerfile = generatedDockerCompose.services["service-one"].build.dockerfile.replace(tempDir, ".");
            generatedDockerCompose.services["service-one"].build.args.REPO_PATH = generatedDockerCompose.services["service-one"].build.args.REPO_PATH.replace(tempDir, ".");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("creates development docker compose correctly node with optional build args", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=node",
                "chs.local.builder.languageVersion=18",
                "chs.local.entrypoint=docker_start.sh",
                "chs.local.builder.outputDir=out/"
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
                metadata: {
                    languageMajorVersion: "18",
                    buildOutputDir: "out/",
                    entrypoint: "docker_start.sh"
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");
            generatedDockerCompose.services["service-one"].build.dockerfile = generatedDockerCompose.services["service-one"].build.dockerfile.replace(tempDir, ".");
            generatedDockerCompose.services["service-one"].build.args.REPO_PATH = generatedDockerCompose.services["service-one"].build.args.REPO_PATH.replace(tempDir, ".");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("creates development docker compose correctly for latest java service", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=java"
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
                builder: "java",
                metadata: {}
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");
            generatedDockerCompose.services["service-one"].build.dockerfile = generatedDockerCompose.services["service-one"].build.dockerfile.replace(tempDir, ".");
            generatedDockerCompose.services["service-one"].build.args.REPO_PATH = generatedDockerCompose.services["service-one"].build.args.REPO_PATH.replace(tempDir, ".");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("creates development docker compose correctly java at specific major service", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=java",
                "chs.local.builder.languageVersion=17"
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
                builder: "java",
                metadata: {
                    languageMajorVersion: "17"
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");
            generatedDockerCompose.services["service-one"].build.dockerfile = generatedDockerCompose.services["service-one"].build.dockerfile.replace(tempDir, ".");
            generatedDockerCompose.services["service-one"].build.args.REPO_PATH = generatedDockerCompose.services["service-one"].build.args.REPO_PATH.replace(tempDir, ".");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("creates development docker compose for repository - with no builder label", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels)
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
                builder: "",
                metadata: {
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("creates development docker compose for repository - with builder and repoContext labels", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=repository",
                "chs.local.repoContext=chs-dev/"
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
                builder: "repository",
                metadata: {
                    repoContext: "chs-dev"
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("creates development docker compose for repository - with builder and dockerfile labels", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=repository",
                "chs.local.dockerfile=chs.Dockerfile"
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
                builder: "repository",
                metadata: {
                    dockerfile: "chs.Dockerfile"
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            generatedDockerCompose.services["service-one"].build.context = generatedDockerCompose.services["service-one"].build.context.replace(tempDir, "./");

            expect(generatedDockerCompose).toMatchSnapshot();
        });

        it("handles env file pointing to services directory when it is a string", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=java",
                "chs.local.builder.languageVersion=17"
            ];

            initialServiceDefinition.services["service-one"].env_file = "service-one.env";

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
                builder: "java",
                metadata: {
                    languageMajorVersion: "17"
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            expect(generatedDockerCompose.services["service-one"].env_file).toBe(
                "../../services/modules/module-one/service-one.env"
            );
        });

        it("handles env file pointing to services directory when it is an array", () => {
            const initialServiceDefinition = parse(readFileSync(serviceDockerComposeFile).toString("utf8"));

            initialServiceDefinition.services["service-one"].labels = [
                ...(initialServiceDefinition.services["service-one"].labels),
                "chs.local.builder=java",
                "chs.local.builder.languageVersion=17"
            ];

            initialServiceDefinition.services["service-one"].env_file = [
                "service-one.env",
                "service-one.env2",
                "../module-two/service-one.env3"
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
                builder: "java",
                metadata: {
                    languageMajorVersion: "17"
                }
            };

            dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);

            const generatedDockerComposeFile = join(tempDir, "local/service-one/docker-compose.yaml");

            expect(existsSync(generatedDockerComposeFile)).toBe(true);

            const generatedDockerCompose = parse(readFileSync(generatedDockerComposeFile).toString("utf8"));

            expect(generatedDockerCompose.services["service-one"].env_file).toEqual([
                "../../services/modules/module-one/service-one.env",
                "../../services/modules/module-one/service-one.env2",
                "../../services/modules/module-two/service-one.env3"
            ]);
        });
    });
});
