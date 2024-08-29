import { expect, jest } from "@jest/globals";
import fs from "fs";
import Config from "../../src/model/Config";
import { ServiceGenerator } from "../../src/generator/service-generator";
import { join } from "path";
import CONSTANTS from "../../src/model/Constants";
import yaml from "yaml";

describe("ServiceGenerator", () => {
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    const mkdirSyncSpy = jest.spyOn(fs, "mkdirSync");

    const testConfig: Config = {
        projectName: "docker-project",
        projectPath: "/home/test-user/docker-project",
        env: {},
        authenticatedRepositories: []
    };

    let serviceGenerator: ServiceGenerator;

    beforeEach(() => {
        jest.resetAllMocks();

        writeFileSyncSpy.mockImplementation((_, __) => { });

        serviceGenerator = new ServiceGenerator(testConfig);
    });

    it("checks if module exists", () => {
        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: { services: {} }
            }
        );

        expect(existsSyncSpy).toHaveBeenCalledWith(
            join(testConfig.projectPath, CONSTANTS.MODULES_DIRECTORY, "new-module")
        );
    });

    it("creates module directory if does not exist", () => {
        existsSyncSpy.mockReturnValueOnce(false).mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: { services: {} }
            }
        );

        expect(mkdirSyncSpy).toHaveBeenCalledWith(
            join(testConfig.projectPath, CONSTANTS.MODULES_DIRECTORY, "new-module")
        );
    });

    it("does not create module directory when already existing", () => {
        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: { services: {} }
            }
        );

        expect(mkdirSyncSpy).not.toHaveBeenCalled();
    });

    for (const forceValue of [false, undefined]) {
        it(`raises error when service already exists and force ${forceValue}`, () => {
            existsSyncSpy.mockReturnValue(true);

            expect(() => serviceGenerator.generateDockerComposeSpecForService(
                "new-service",
                "module-name",
                {
                    initialSpecValue: { services: {} },
                    force: forceValue
                }
            )).toThrowError();
        });
    }

    it("does not raise error when service exists and force set to true", () => {
        existsSyncSpy.mockReturnValue(true);

        expect(() => serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "module-name",
            {
                initialSpecValue: { services: {} },
                force: true
            }
        )).not.toThrowError();
    });

    it("writes out to the correct file at the end", () => {
        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: { services: {} }
            }
        );

        expect(writeFileSyncSpy).toHaveBeenCalledWith(
            join(testConfig.projectPath, CONSTANTS.MODULES_DIRECTORY, "new-module/new-service.docker-compose.yaml"),
            expect.anything()
        );
    });

    it("removes all labels defined by input when none supplied", () => {
        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {
                            labels: [
                                "chs.repository.branch=a-branch",
                                "chs.description=description of the other service",
                                "traefik.http.routers.new-service.rule=Host(`another`)",
                                "traefik.http.routers.new-service.priority=6"
                            ]
                        }
                    }
                }
            }
        );

        expect(yamlStringifySpy).toHaveBeenCalledTimes(1);

        const stringifyCall = yamlStringifySpy.mock.calls[0];

        expect(stringifyCall[0].services["new-service"].labels).toEqual([]);
    });

    it("appends new values to labels", () => {
        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        yamlStringifySpy.mockReturnValue("");

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {
                            labels: [
                                "chs.repository.branch=a-branch",
                                "chs.description=description of the other service",
                                "traefik.http.routers.new-service.rule=Host(`another`)",
                                "traefik.http.routers.new-service.priority=6"
                            ]
                        }
                    }
                },
                descriptionLabel: "new description",
                traefikRuleLabel: "Host(`newhost.com`)",
                traefikPriorityLabel: "43",
                gitHubRepoBranchName: "feature/branchNAme"
            }
        );

        expect(yamlStringifySpy).toHaveBeenCalledTimes(1);

        const stringifyCall = yamlStringifySpy.mock.calls[0];

        expect(stringifyCall[0].services["new-service"].labels).toEqual([
            "chs.repository.branch=feature/branchNAme",
            "chs.description=new description",
            "traefik.http.routers.new-service.rule=Host(`newhost.com`)",
            "traefik.http.routers.new-service.priority=43"
        ]);

    });

    it("can handle record of labels", () => {

        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        yamlStringifySpy.mockReturnValue("");

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {
                            labels: {
                                "another.label": "foobar",
                                "chs.repository.branch": "a-branch",
                                "chs.description": "description of the other service",
                                "traefik.http.routers.new-service.rule": "Host(`another`)",
                                "traefik.http.routers.new-service.priority": "6"
                            }
                        }
                    }
                },
                descriptionLabel: "new description",
                traefikRuleLabel: "Host(`newhost.com`)",
                traefikPriorityLabel: "43",
                gitHubRepoBranchName: "feature/branchNAme"
            }
        );

        expect(yamlStringifySpy).toHaveBeenCalledTimes(1);

        const stringifyCall = yamlStringifySpy.mock.calls[0];

        expect(stringifyCall[0].services["new-service"].labels).toEqual({
            "another.label": "foobar",
            "chs.repository.branch": "feature/branchNAme",
            "chs.description": "new description",
            "traefik.http.routers.new-service.rule": "Host(`newhost.com`)",
            "traefik.http.routers.new-service.priority": "43"
        });
    });

    it("can handle record of labels - none to be set", () => {

        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        yamlStringifySpy.mockReturnValue("");

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {
                            labels: {
                                "another.label": "foobar",
                                "chs.repository.branch": "a-branch",
                                "chs.description": "description of the other service",
                                "traefik.http.routers.new-service.rule": "Host(`another`)",
                                "traefik.http.routers.new-service.priority": "6"
                            }
                        }
                    }
                }
            }
        );

        expect(yamlStringifySpy).toHaveBeenCalledTimes(1);

        const stringifyCall = yamlStringifySpy.mock.calls[0];

        expect(stringifyCall[0].services["new-service"].labels).toEqual({
            "another.label": "foobar"
        });
    });

    it("can handle no labels", () => {
        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        yamlStringifySpy.mockReturnValue("");

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {}
                    }
                },
                descriptionLabel: "new description",
                traefikRuleLabel: "Host(`newhost.com`)",
                traefikPriorityLabel: "43",
                gitHubRepoBranchName: "feature/branchNAme"
            }
        );

        expect(yamlStringifySpy).toHaveBeenCalledTimes(1);

        const stringifyCall = yamlStringifySpy.mock.calls[0];

        expect(stringifyCall[0].services["new-service"].labels).toEqual([]);
    });

    it("sets container name", () => {
        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        yamlStringifySpy.mockReturnValue("");

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {
                            container_name: "my-old-dilapidated-service"
                        }
                    }
                },
                containerName: "my-awesome-new-service"
            }
        );

        expect(yamlStringifySpy).toHaveBeenCalledTimes(1);

        const stringifyCall = yamlStringifySpy.mock.calls[0];

        expect(stringifyCall[0].services["new-service"].container_name).toEqual(
            "my-awesome-new-service"
        );
    });

    it("removes container name when not set", () => {
        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        yamlStringifySpy.mockReturnValue("");

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {
                            container_name: "my-old-dilapidated-service"
                        }
                    }
                }
            }
        );

        expect(yamlStringifySpy).toHaveBeenCalledTimes(1);

        const stringifyCall = yamlStringifySpy.mock.calls[0];

        expect(Object.keys(stringifyCall[0].services["new-service"])).not.toContain("container_name");
    });

    it("returns path to the newly created service", () => {
        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        const specOutput = `
services:
  service-one:
    image: my-image`;

        yamlStringifySpy.mockReturnValue(specOutput);

        existsSyncSpy.mockReturnValueOnce(true)
            .mockReturnValue(false);

        const result = serviceGenerator.generateDockerComposeSpecForService(
            "new-service",
            "new-module",
            {
                initialSpecValue: {
                    services: {
                        "new-service": {
                            container_name: "my-old-dilapidated-service"
                        }
                    }
                }
            }
        );

        expect(result).toEqual(
            specOutput
        );
    });
});
