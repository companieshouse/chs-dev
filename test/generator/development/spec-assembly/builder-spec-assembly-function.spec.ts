import { expect } from "@jest/globals";
import yaml from "yaml";
import builderSpecAssemblyFunction from "../../../../src/generator/development/spec-assembly/builder-spec-assembly-function";
import BuilderDockerComposeSpec from "../../../../src/model/BuilderDockerComposeSpec";
import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec";
import { services } from "../../../utils/data";
import { generateBuilderSpec, generateServiceSpec } from "../../../utils/docker-compose-spec";
import Service from "../../../../src/model/Service";
import { join } from "path";

describe("builderSpecAssemblyFunction", () => {

    const service = services[3];
    const builderLocation = "local/builders/java/v2";
    const projectPath = "/home/test/user/projects/docker-project";
    const serviceDockerComposeSpec = generateServiceSpec(service);

    let builderDockerComposeSpec: BuilderDockerComposeSpec;

    beforeEach(() => {
        builderDockerComposeSpec = {
            builderSpec: generateBuilderSpec(
                builderLocation, true
            ),
            name: "java",
            version: "v2"
        };
    });

    it("adds extra builder service to the generated spec", () => {
        const developmentDockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath,
            serviceDockerComposeSpec,
            builderDockerComposeSpec
        });

        expect(developmentDockerComposeSpec.services).toMatchSnapshot();
    });

    it("adds dependency builder on service and can handle no dependencies present", () => {
        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath,
            serviceDockerComposeSpec,
            builderDockerComposeSpec
        });

        expect(developmentDockerComposeSpec.services).toMatchSnapshot();
    });

    it("adds dependency builder on service and can handle dependencies present", () => {
        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {
                    depends_on: {
                        "service-two": {
                            condition: "service_started"
                        }
                    }
                }
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath,
            serviceDockerComposeSpec,
            builderDockerComposeSpec
        });

        expect(developmentDockerComposeSpec.services).toMatchSnapshot();
    });

    it("applies extra properties to service", () => {
        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath,
            serviceDockerComposeSpec,
            builderDockerComposeSpec
        });

        expect(developmentDockerComposeSpec.services).toMatchSnapshot();
    });

    it("can handle repository builder", () => {
        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [service.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath,
            serviceDockerComposeSpec,
            builderDockerComposeSpec: {
                name: "repository",
                version: "v1",
                builderSpec: yaml.stringify({
                    services: {
                        "<service>": {
                            build: {
                                context: "<absolute_repository_path>"
                            }
                        }
                    }
                })
            }
        });

        expect(developmentDockerComposeSpec.services).toMatchSnapshot();
    });

    it("can handle setting repository context for repo builder", () => {
        const serviceWithContext = { ...services[7] };
        const repoContext = "tilt/";
        serviceWithContext.metadata.repoContext = repoContext;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [serviceWithContext.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            projectPath,
            serviceDockerComposeSpec: generateServiceSpec(serviceWithContext),
            service: serviceWithContext,
            builderDockerComposeSpec: {
                name: "repository",
                version: "v1",
                builderSpec: yaml.stringify({
                    services: {
                        "<service>": {
                            build: {
                                context: "<absolute_repository_path>"
                            }
                        }
                    }
                })
            }
        });

        expect(developmentDockerComposeSpec.services[serviceWithContext.name]).toMatchSnapshot();
    });

    it("can handle setting dockerfile for repo builder", () => {
        const serviceWithDockerfile: Service = { ...services[2] };
        const dockerfile = "tilt/Dockerfile";
        serviceWithDockerfile.metadata.dockerfile = dockerfile;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [serviceWithDockerfile.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            projectPath,
            serviceDockerComposeSpec: generateServiceSpec(serviceWithDockerfile),
            service: serviceWithDockerfile,
            builderDockerComposeSpec: {
                name: "repository",
                version: "v1",
                builderSpec: yaml.stringify({
                    services: {
                        "<service>": {
                            build: {
                                context: "<absolute_repository_path>"
                            }
                        }
                    }
                })
            }
        });

        expect(developmentDockerComposeSpec.services[serviceWithDockerfile.name]).toMatchSnapshot();
    });

    it("can handle setting dockerfile and context for repo builder", () => {
        const serviceWithDockerfileAndContext: Service = { ...services[3] };
        const context = "another-dir/";
        const dockerfile = "another.Dockerfile";
        serviceWithDockerfileAndContext.metadata.dockerfile = dockerfile;
        serviceWithDockerfileAndContext.metadata.repoContext = context;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [serviceWithDockerfileAndContext.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            projectPath,
            serviceDockerComposeSpec: generateServiceSpec(serviceWithDockerfileAndContext),
            service: serviceWithDockerfileAndContext,
            builderDockerComposeSpec: {
                name: "repository",
                version: "v1",
                builderSpec: yaml.stringify({
                    services: {
                        "<service>": {
                            build: {
                                context: "<absolute_repository_path>"
                            }
                        }
                    }
                })
            }
        });

        expect(developmentDockerComposeSpec.services[serviceWithDockerfileAndContext.name]).toMatchSnapshot();
    });

    it("can handle using builder and service dockerfile", () => {
        const serviceBuildServiceFromRepo: Service = { ...services[0] };
        serviceBuildServiceFromRepo.metadata.builderUseServiceDockerFile = "true";

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [serviceBuildServiceFromRepo.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            projectPath,
            serviceDockerComposeSpec: generateServiceSpec(serviceBuildServiceFromRepo),
            service: serviceBuildServiceFromRepo,
            builderDockerComposeSpec
        });

        expect(developmentDockerComposeSpec.services[serviceBuildServiceFromRepo.name]).toMatchSnapshot();

        expect(developmentDockerComposeSpec.services[`${serviceBuildServiceFromRepo.name}-builder`]).toMatchSnapshot();
    });

    it("can handle using builder and service dockerfile appending custom context and dockerfile", () => {
        const serviceBuildServiceFromRepo: Service = { ...services[0] };
        serviceBuildServiceFromRepo.metadata.builderUseServiceDockerFile = "true";

        const context = "another-dir/";
        const dockerfile = "another.Dockerfile";
        serviceBuildServiceFromRepo.metadata.dockerfile = dockerfile;
        serviceBuildServiceFromRepo.metadata.repoContext = context;

        const developmentDockerComposeSpec: DockerComposeSpec = {
            services: {
                [serviceBuildServiceFromRepo.name]: {}
            }
        };

        builderSpecAssemblyFunction(developmentDockerComposeSpec, {
            projectPath,
            serviceDockerComposeSpec: generateServiceSpec(serviceBuildServiceFromRepo),
            service: serviceBuildServiceFromRepo,
            builderDockerComposeSpec
        });

        expect(developmentDockerComposeSpec.services[serviceBuildServiceFromRepo.name]).toMatchSnapshot();

        expect(developmentDockerComposeSpec.services[`${serviceBuildServiceFromRepo.name}-builder`]).toMatchSnapshot();
    });
});
