import { expect, jest } from "@jest/globals";
import {
    input as inputMock,
    confirm as confirmMock,
    editor as editorMock
} from "../../src/helpers/user-input";
import fs from "fs";
import yaml from "yaml";
import { services, modules } from "../utils/data";
import ServiceFactory from "../../src/run/service-factory";
import Config from "../../src/model/Config";
import { Inventory } from "../../src/state/inventory";
import { join } from "path";
import { ServiceGenerator } from "../../src/generator/service-generator";
import { generateServiceSpec } from "../utils/docker-compose-spec";
import CONSTANTS from "../../src/model/Constants";

jest.mock("../../src/helpers/user-input");
jest.mock("../../src/generator/service-generator");

describe("ServiceFactory createNewBasedOn", () => {

    const readFileSyncSpy = jest.spyOn(fs, "readFileSync");
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");

    const inventoryMock = {
        services,
        modules
    };

    const serviceGeneratorMock = {
        generateDockerComposeSpecForService: jest.fn()
    };

    const testConfig: Config = {
        projectName: "test",
        projectPath: "/home/test-user/docker-project",
        env: {},
        authenticatedRepositories: []
    };
    const newServiceName = "new-service";

    const generatedDockerComposeSpecForService = yaml.stringify(generateServiceSpec(services[1]));

    const setReadFileSyncOutput = (
        serviceName: string,
        {
            defaultBranchName,
            traefikPriority,
            containerName,
            dependsOn = [],
            localPrefix = false
        }: {
            localPrefix?: boolean,
            containerName?: string,
            defaultBranchName?: string
            traefikPriority?: number,
            dependsOn?: string[] | Record<string, Record<string, any>>
        }
    ) => {
        const serviceSpec = {
            services: {
                [serviceName]: {
                    image: `123456789.ecr.eu-west-2.amazonaws.com/${localPrefix ? "local/" : ""}${serviceName}`,
                    labels: [
                        "another.label=foobar",
                        `chs.description=a service called ${serviceName}`,
                        `chs.repository.url=git@github.com:companieshouse/${serviceName}`,
                        ...(
                            typeof defaultBranchName !== "undefined"
                                ? [`chs.repository.branch=${defaultBranchName}`]
                                : []
                        ),
                        `traefik.http.routers.${serviceName}.rule=Host(\`chs.local\`)`,
                        ...(
                            typeof traefikPriority !== "undefined"
                                ? [`traefik.http.routers.${serviceName}.priority=${traefikPriority}`]
                                : []
                        )
                    ],
                    ...(
                        typeof containerName !== "undefined"
                            ? {
                                container_name: containerName
                            }
                            : {}
                    ),
                    environment: [
                        "ENV_VAR_ONE=foo",
                        "ENV_VAR_TWO=bar"
                    ],
                    expose: [
                        3000
                    ],
                    ports: [
                        "9098:8479"
                    ],
                    depends_on: dependsOn
                }
            }
        };

        readFileSyncSpy.mockReturnValue(
            Buffer.from(
                yaml.stringify(
                    serviceSpec
                ),
                "utf8"
            )
        );
    };

    let serviceFactory: ServiceFactory;

    beforeEach(() => {
        jest.resetAllMocks();

        writeFileSyncSpy.mockImplementation((_, __) => {});

        // @ts-expect-error
        editorMock.mockResolvedValue(generatedDockerComposeSpecForService);

        // @ts-expect-error
        ServiceGenerator.mockReturnValue(serviceGeneratorMock);

        serviceFactory = new ServiceFactory(testConfig, inventoryMock as Inventory);

        serviceGeneratorMock.generateDockerComposeSpecForService.mockReturnValue(generatedDockerComposeSpecForService);
    });

    it("reads in origin service file", async () => {
        const baseService = services[1];

        setReadFileSyncOutput(baseService.name, {});

        await serviceFactory.createNewBasedOn(
            baseService.name,
            {
                gitHubRepoName: newServiceName,
                moduleName: "new-module",
                containerName: "container-name",
                descriptionLabel: "a description for the service",
                traefikRuleLabel: "Host(`new-service`)",
                traefikPriorityLabel: "2",
                gitHubRepoBranchName: "develop"
            }
        );

        expect(readFileSyncSpy).toHaveBeenCalledWith(
            join(baseService.source)
        );
    });

    it("overrides the appropriate values when all supplied", async () => {
        const baseService = services[1];

        setReadFileSyncOutput(baseService.name, {});

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            moduleName: "new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(serviceGeneratorMock.generateDockerComposeSpecForService).toHaveBeenCalledWith(
            newServiceOptions.gitHubRepoName,
            newServiceOptions.moduleName,
            {
                initialSpecValue: expect.anything(),
                containerName: newServiceOptions.containerName,
                descriptionLabel: newServiceOptions.descriptionLabel,
                traefikRuleLabel: newServiceOptions.traefikRuleLabel,
                traefikPriorityLabel: newServiceOptions.traefikPriorityLabel,
                gitHubRepoBranchName: newServiceOptions.gitHubRepoBranchName
            }
        );
    });

    it("replaces dots in gh repo name with dashes", async () => {
        const baseService = services[1];

        setReadFileSyncOutput(baseService.name, {});

        const newServiceOptions = {
            gitHubRepoName: "a.new.service.with.dots",
            moduleName: "new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(serviceGeneratorMock.generateDockerComposeSpecForService).toHaveBeenCalledWith(
            "a-new-service-with-dots",
            newServiceOptions.moduleName,
            {
                initialSpecValue: expect.anything(),
                containerName: newServiceOptions.containerName,
                descriptionLabel: newServiceOptions.descriptionLabel,
                traefikRuleLabel: newServiceOptions.traefikRuleLabel,
                traefikPriorityLabel: newServiceOptions.traefikPriorityLabel,
                gitHubRepoBranchName: newServiceOptions.gitHubRepoBranchName
            }
        );
    });

    it("can have local in image", async () => {
        const baseService = services[3];

        setReadFileSyncOutput(baseService.name, {
            localPrefix: true
        });

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            moduleName: "new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        const generatorCall = serviceGeneratorMock.generateDockerComposeSpecForService.mock.calls[0];

        const options = generatorCall[2];

        // @ts-expect-error
        expect(options.initialSpecValue.services[newServiceOptions.gitHubRepoName].image).toEqual(
            `123456789.ecr.eu-west-2.amazonaws.com/local/${newServiceOptions.gitHubRepoName}`
        );
    });

    it("prompts user to confirm whether they want to supply value for each attribute when none supplied", async () => {
        // @ts-expect-error
        confirmMock.mockResolvedValue(false);

        const baseService = services[1];

        setReadFileSyncOutput(baseService.name, {});

        const newServiceOptions = {
            gitHubRepoName: "new-service-name"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(confirmMock).toHaveBeenCalledTimes(6);

        expect(confirmMock).toHaveBeenCalledWith(
            `Do you want to provide a value for container name?`
        );
        expect(confirmMock).toHaveBeenCalledWith(
            `Do you want to provide a value for description label?`
        );
        expect(confirmMock).toHaveBeenCalledWith(
            `Do you want to provide a value for repository branch label?`
        );
        expect(confirmMock).toHaveBeenCalledWith(
            `Do you want to provide a value for Traefik rule label?`
        );
        expect(confirmMock).toHaveBeenCalledWith(
            `Do you want to provide a value for Traefik priority label?`
        );
    });

    it("prompts user to supply values when user wants to provide all details", async () => {
        // @ts-expect-error
        confirmMock.mockResolvedValue(true);

        const baseService = services[4];

        setReadFileSyncOutput(baseService.name, {});

        const newServiceOptions = {
            gitHubRepoName: "new-service-name",
            moduleName: "new-module"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(inputMock).toHaveBeenCalledTimes(5);

        expect(inputMock).toHaveBeenCalledWith(
            `Enter a value for the container name`
        );
        expect(inputMock).toHaveBeenCalledWith(
            `Enter a value for the description label`
        );
        expect(inputMock).toHaveBeenCalledWith(
            `Enter a value for the repository branch label`
        );
        expect(inputMock).toHaveBeenCalledWith(
            `Enter a value for the Traefik rule label`
        );
        expect(inputMock).toHaveBeenCalledWith(
            `Enter a value for the Traefik priority label`
        );
    });

    it("prompts the user to supply module when not specified", async () => {
        const baseService = services[4];

        setReadFileSyncOutput(baseService.name, {});

        const newServiceOptions = {
            gitHubRepoName: "new-service-name",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(inputMock).toHaveBeenCalledTimes(1);
        expect(inputMock).toHaveBeenCalledWith("Enter the name of the module the service is part of");
    });

    it("uses the supplied version of module when not provided in options", async () => {
        const baseService = services[2];

        // @ts-expect-error
        inputMock.mockResolvedValue("module-specced-by-input");

        setReadFileSyncOutput(baseService.name, {
            localPrefix: true
        });

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        const generatorCall = serviceGeneratorMock.generateDockerComposeSpecForService.mock.calls[0];

        const moduleSpecified = generatorCall[1];

        expect(moduleSpecified).toEqual("module-specced-by-input");
    });

    it("prompts the user whether they want to edit the generated service", async () => {
        const baseService = services[2];

        setReadFileSyncOutput(baseService.name, {
            localPrefix: true
        });

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            moduleName: "my-new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(confirmMock).toHaveBeenCalledWith(
            "Do you want to modify the generated service?"
        );
    });

    it("allows user to edit when the user accepts prompt", async () => {
        const baseService = services[2];

        setReadFileSyncOutput(baseService.name, {
            localPrefix: true
        });

        // @ts-expect-error
        confirmMock.mockResolvedValue(true);

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            moduleName: "my-new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(editorMock).toHaveBeenCalledWith(
            "Modify the file accordingly",
            {
                initialValue: generatedDockerComposeSpecForService,
                waitForUserInput: false
            }
        );
    });

    it("does not open the file in editor when user does not want to edit the file", async () => {
        const baseService = services[2];

        setReadFileSyncOutput(baseService.name, {
            localPrefix: true
        });

        // @ts-expect-error
        confirmMock.mockResolvedValue(false);

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            moduleName: "my-new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(editorMock).not.toHaveBeenCalled();
    });

    it("writes the changes to file when the file has changed", async () => {
        const baseService = services[2];

        const modifiedSpec = `
${generatedDockerComposeSpecForService}
        depends_on:
            - another-service
`;

        setReadFileSyncOutput(baseService.name, {
            localPrefix: true
        });

        // @ts-expect-error
        confirmMock.mockResolvedValue(true);

        // @ts-expect-error
        editorMock.mockResolvedValue(modifiedSpec);

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            moduleName: "my-new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(writeFileSyncSpy).toHaveBeenCalledWith(
            join(testConfig.projectPath, CONSTANTS.MODULES_DIRECTORY, "my-new-module", `${newServiceName}.docker-compose.yaml`),
            Buffer.from(modifiedSpec, "utf8")
        );
    });

    it("does not write service file when no changes made", async () => {
        const baseService = services[2];

        setReadFileSyncOutput(baseService.name, {
            localPrefix: true
        });

        // @ts-expect-error
        confirmMock.mockResolvedValue(true);

        // @ts-expect-error
        editorMock.mockResolvedValue(generatedDockerComposeSpecForService);

        const newServiceOptions = {
            gitHubRepoName: newServiceName,
            moduleName: "my-new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        );

        expect(writeFileSyncSpy).not.toHaveBeenCalled();
    });

    it("raises an error when service exists in module already", async () => {
        const baseService = services[2];

        const newServiceOptions = {
            gitHubRepoName: baseService.name,
            moduleName: baseService.module,
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await expect(serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        )).rejects.toMatchInlineSnapshot(`[Error: A service with name: ${baseService.name} already exists in module ${baseService.module}]`);
    });

    it("raises an error when the service name is not unique", async () => {
        const baseService = services[2];

        const newServiceOptions = {
            gitHubRepoName: baseService.name,
            moduleName: "new-module",
            containerName: "container-name",
            descriptionLabel: "a description for the service",
            traefikRuleLabel: "Host(`new-service`)",
            traefikPriorityLabel: "2",
            gitHubRepoBranchName: "develop"
        };

        await expect(serviceFactory.createNewBasedOn(
            baseService.name,
            newServiceOptions
        )).rejects.toMatchInlineSnapshot(`[Error: A service with name: ${baseService.name} already exists in module ${baseService.module}]`);
    });
});
