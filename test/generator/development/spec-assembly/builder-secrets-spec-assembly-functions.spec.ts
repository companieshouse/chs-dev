import { expect, jest } from "@jest/globals";
import fs from "fs";
import { DockerComposeSpec } from "../../../../src/model/DockerComposeSpec";

import { services } from "../../../utils/data";
import builderSecretsSpecAssemblyFunction from "../../../../src/generator/development/spec-assembly/builder-secrets-spec-assembly-function";
import yaml from "yaml";
import { join } from "path";
import CONSTANTS from "../../../../src/model/Constants";
import Service from "../../../../src/model/Service";

describe("builderSecretsSpecAssemblyFunction", () => {
    const readFileSyncSpy = jest.spyOn(fs, "readFileSync");

    let service: Service;
    let developmentDockerComposeSpec: DockerComposeSpec;
    let developmentDockerComposeSpecNoBuilder: DockerComposeSpec;

    beforeEach(() => {
        jest.resetAllMocks();

        service = services[0];
        developmentDockerComposeSpec = {
            services: {
                [`${service.name}-builder`]: {},
                [service.name]: {}
            }
        };
        developmentDockerComposeSpecNoBuilder = {
            services: {
                [service.name]: {}
            }
        };

        delete service.metadata.secretsRequired;
    });

    it("reads in initial docker compose file", () => {
        service.metadata.secretsRequired = "true";

        readFileSyncSpy.mockReturnValue(Buffer.from(yaml.stringify({
            secrets: {
                "secret-one": {
                    environment: "ENV_VAR_ONE"
                },
                "secret-two": {
                    file: "./file.txt"
                }
            }
        }), "utf-8"));

        builderSecretsSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath: "/home/testuser/docker-c",
            serviceDockerComposeSpec: {
                services: {}
            },
            builderDockerComposeSpec: {
                builderSpec: "",
                name: "",
                version: ""
            }
        });

        expect(readFileSyncSpy).toHaveBeenCalledWith(
            join("/home/testuser/docker-c", CONSTANTS.BASE_DOCKER_COMPOSE_FILE),
            "utf8"
        );
    });

    it("adds secrets to builder when service defines requiresSecrets", () => {
        service.metadata.secretsRequired = "true";

        readFileSyncSpy.mockReturnValue(Buffer.from(yaml.stringify({
            secrets: {
                "secret-one": {
                    environment: "ENV_VAR_ONE"
                },
                "secret-two": {
                    file: "./file.txt"
                }
            }
        }), "utf-8"));

        builderSecretsSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath: "/home/testuser/docker-c",
            serviceDockerComposeSpec: {
                services: {}
            },
            builderDockerComposeSpec: {
                builderSpec: "",
                name: "",
                version: ""
            }
        });

        expect(developmentDockerComposeSpec.services[`${service.name}-builder`].secrets)
            .toEqual([
                "secret-one",
                "secret-two"
            ]);
    });

    it("does not set secrets when there are no secrets in initial docker compose", () => {
        service.metadata.secretsRequired = "true";

        readFileSyncSpy.mockReturnValue(Buffer.from(yaml.stringify({ }), "utf-8"));

        builderSecretsSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath: "/home/testuser/docker-c",
            serviceDockerComposeSpec: {
                services: {}
            },
            builderDockerComposeSpec: {
                builderSpec: "",
                name: "",
                version: ""
            }
        });

        expect(developmentDockerComposeSpec.services[`${service.name}-builder`].secrets).toBeUndefined();
    });

    it("does not set secrets on main service", () => {
        service.metadata.secretsRequired = "true";

        readFileSyncSpy.mockReturnValue(Buffer.from(yaml.stringify({
            secrets: {
                "secret-one": {
                    environment: "ENV_VAR_ONE"
                },
                "secret-two": {
                    file: "./file.txt"
                }
            }
        }), "utf-8"));

        builderSecretsSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath: "/home/testuser/docker-c",
            serviceDockerComposeSpec: {
                services: {}
            },
            builderDockerComposeSpec: {
                builderSpec: "",
                name: "",
                version: ""
            }
        });

        expect(developmentDockerComposeSpec.services[service.name].secrets).toBeUndefined();
    });

    it("set secrets on main service when no builder", () => {
        service.metadata.secretsRequired = "true";

        readFileSyncSpy.mockReturnValue(Buffer.from(yaml.stringify({
            secrets: {
                "secret-one": {
                    environment: "ENV_VAR_ONE"
                },
                "secret-two": {
                    file: "./file.txt"
                }
            }
        }), "utf-8"));

        builderSecretsSpecAssemblyFunction(developmentDockerComposeSpecNoBuilder, {
            service,
            projectPath: "/home/testuser/docker-c",
            serviceDockerComposeSpec: {
                services: {}
            },
            builderDockerComposeSpec: {
                builderSpec: "",
                name: "",
                version: ""
            }
        });

        expect(developmentDockerComposeSpecNoBuilder.services[service.name].secrets)
            .toEqual([
                "secret-one",
                "secret-two"
            ]);
    });

    it("does not set secrets when secretsRequired not set", () => {
        readFileSyncSpy.mockReturnValue(Buffer.from(yaml.stringify({
            secrets: {
                "secret-one": {
                    environment: "ENV_VAR_ONE"
                },
                "secret-two": {
                    file: "./file.txt"
                }
            }
        }), "utf-8"));

        builderSecretsSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath: "/home/testuser/docker-c",
            serviceDockerComposeSpec: {
                services: {}
            },
            builderDockerComposeSpec: {
                builderSpec: "",
                name: "",
                version: ""
            }
        });

        expect(developmentDockerComposeSpec.services[`${service.name}-builder`].secrets).toBeUndefined();
    });

    it("does not read spec in when secrets not required", () => {
        builderSecretsSpecAssemblyFunction(developmentDockerComposeSpec, {
            service,
            projectPath: "/home/testuser/docker-c",
            serviceDockerComposeSpec: {
                services: {}
            },
            builderDockerComposeSpec: {
                builderSpec: "",
                name: "",
                version: ""
            }
        });

        expect(readFileSyncSpy).not.toHaveBeenCalled();
    });
});
