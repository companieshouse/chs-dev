import { expect, jest, test } from "@jest/globals";
import buildServiceSpecFactoryMock from "../../src/run/service-factory/build-service-spec";
import ServiceFactory from "../../src/run/ServiceFactory";
import { confirm as confirmMock } from "../../src/helpers/user-input";
import NewServiceSpec from "../../src/model/NewServiceSpec";
import yaml from "yaml";
import CONSTANTS from "../../src/model/Constants";
import { createPullRequest as createPullRequestMock } from "../../src/helpers/github";
import fsMock from "fs";

jest.mock("../../src/run/service-factory/build-service-spec");
jest.mock("../../src/helpers/user-input");
jest.mock("../../src/helpers/github");
jest.mock("fs");

const serviceSpecRepositoryMock = {
    load: jest.fn(),
    initialise: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    commitAndPush: jest.fn(),
    close: jest.fn()
};

const newServiceSpec: NewServiceSpec = {
    name: "my-new-service",
    type: {
        name: "MICROSERVICE",
        language: "JAVA"
    },
    description: "My new service",
    configuration: {
        java: {
            spring_initializr_url: "https://start.spring.io#!p=134"
        },
        "docker-chs-development": {
            module: "module"
        }
    },
    submission_details: {
        by: "Test User",
        github_username: "ch-test-user"
    },
    ownership: {
        team: "Element",
        service: "Common Component"
    },
    sensitive: true,
    sensitivity_justification: "It's sensitive alright!"
};

const testDateTime = new Date(2025, 0, 8, 0, 0, 0);

describe("ServiceFactory", () => {

    let serviceFactory: ServiceFactory;

    const buildServiceSpecMock = jest.fn();

    beforeEach(() => {
        jest.resetAllMocks();
        serviceFactory = new ServiceFactory(serviceSpecRepositoryMock as never);

        // @ts-expect-error  This is mocked and so the function should be there
        buildServiceSpecFactoryMock.mockReturnValue(buildServiceSpecMock);

        // @ts-expect-error
        Date.now = () => testDateTime;
    });

    it("loads the repository", async () => {
        await serviceFactory.createNewService("my-new-service");

        expect(serviceSpecRepositoryMock.load).toHaveBeenCalled();
    });

    it("initialises the repository", async () => {
        await serviceFactory.createNewService("my-new-service");

        expect(serviceSpecRepositoryMock.initialise).toHaveBeenCalledWith("feature/add-my-new-service-2025-01-08");
    });

    test.each([
        ["My_New_Service", "my-new-service"],
        ["My_New_Service234", "my-new-service234"],
        ["My&New&Service", "my-new-service"],
        ["My.New.&Service", "my.new.-service"]
    ])("initialises replaces %s with %s in branch name", async (serviceName, expectedServiceNameInBranch) => {

        await serviceFactory.createNewService(serviceName);

        expect(serviceSpecRepositoryMock.initialise).toHaveBeenCalledWith(`feature/add-${expectedServiceNameInBranch}-2025-01-08`);
    });

    it("gets the initial state of the service", async () => {
        await serviceFactory.createNewService("my-new-service");

        expect(serviceSpecRepositoryMock.get).toHaveBeenCalledWith("my-new-service");
    });

    it("closes the repository when complete", async () => {
        await serviceFactory.createNewService("my-new-service");

        expect(serviceSpecRepositoryMock.close).toHaveBeenCalled();
    });

    it("constructs the new service spec", async () => {
        serviceSpecRepositoryMock.get.mockReturnValue(undefined);

        await serviceFactory.createNewService("my-new-service");

        expect(buildServiceSpecMock).toHaveBeenCalledWith({
            name: "my-new-service"
        });
    });

    it("asks user to confirm amendment when service spec already exists", async () => {
        (confirmMock as jest.MockedFunction<typeof confirmMock>).mockResolvedValue(true);

        serviceSpecRepositoryMock.get.mockReturnValue({
            name: "service"
        });

        await serviceFactory.createNewService("service");

        expect(confirmMock).toHaveBeenCalledWith(
            "Are you sure you want to modify the existing service specification for service: service?"
        );
    });

    it("passes service to service spec builder when user accepts", async () => {
        (confirmMock as jest.MockedFunction<typeof confirmMock>).mockResolvedValue(true);

        serviceSpecRepositoryMock.get.mockReturnValue({
            name: "service",
            description: "service description"
        });

        await serviceFactory.createNewService("service");

        expect(buildServiceSpecMock).toHaveBeenCalledWith({
            name: "service",
            description: "service description"
        });
    });

    it("rejects if the user does not want to overwrite the existing service spec", async () => {
        (confirmMock as jest.MockedFunction<typeof confirmMock>).mockResolvedValue(false);

        serviceSpecRepositoryMock.get.mockReturnValue({
            name: "service",
            description: "service description"
        });

        await expect(serviceFactory.createNewService("service")).rejects.toEqual(
            new Error("The service: service already exists and was not modified.")
        );
    });

    it("closes the repository when there is an error", async () => {
        (confirmMock as jest.MockedFunction<typeof confirmMock>).mockResolvedValue(false);

        serviceSpecRepositoryMock.get.mockReturnValue({
            name: "service",
            description: "service description"
        });

        await expect(serviceFactory.createNewService("service")).rejects.toBeDefined();

        expect(serviceSpecRepositoryMock.close).toHaveBeenCalled();
    });

    it("puts the new service spec into the repository", async () => {
        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service");

        expect(serviceSpecRepositoryMock.put).toHaveBeenCalledWith("my-new-service", newServiceSpec);
    });

    it("commits and pushes the new service spec to the repository", async () => {
        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service");

        expect(serviceSpecRepositoryMock.commitAndPush).toHaveBeenCalledWith(
            "Add new service: my-new-service",
            "* Create new service specification for my-new-service",
            "```json",
            JSON.stringify(newServiceSpec, null, 2),
            "```"
        );
    });

    it("does not commit and push when is dry run", async () => {
        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service", true);

        expect(serviceSpecRepositoryMock.commitAndPush).not.toHaveBeenCalled();
    });

    it("closes the repository when complete dry run", async () => {
        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service", true);

        expect(serviceSpecRepositoryMock.close).toHaveBeenCalled();
    });

    it("prints out the created service spec on dry run", async () => {
        const consoleLogSpy = jest.spyOn(console, "log");

        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service", true);

        expect(consoleLogSpy).toBeCalledWith(
            `(dry-run) Would have committed and pushed ${CONSTANTS.NEW_SERVICE_SPECS_PATH}/my-new-service.yaml with the following content:`
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(yaml.stringify(newServiceSpec));
    });

    it("creates a pull request when not a dry run", async () => {
        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service");

        expect(createPullRequestMock).toHaveBeenCalledWith(
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_NAME,
            "feature/add-my-new-service-2025-01-08",
            "Create new service specification for my-new-service",
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_BRANCH
        );
    });

    it("does not attempt to create a pull request when is dry run", async () => {
        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service", true);

        expect(createPullRequestMock).not.toHaveBeenCalled();
    });

    it("reads supplied file and creates a new service spec", async () => {
        const newServiceSpecOverrides = {
            name: "my-new-service",
            type: {
                name: "MICROSERVICE"
            }
        };

        (fsMock.readFileSync as jest.Mock).mockReturnValue(
            Buffer.from(yaml.stringify(newServiceSpecOverrides), "utf-8")
        );

        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await serviceFactory.createNewService("my-new-service", true, "path/to/file.yaml");

        expect(fsMock.readFileSync).toHaveBeenCalledWith("path/to/file.yaml");

        expect(buildServiceSpecMock).toHaveBeenCalledWith({
            ...newServiceSpecOverrides
        });
    });

    it("throws error when yaml file is not valid", async () => {
        (fsMock.readFileSync as jest.Mock).mockReturnValue(
            Buffer.from("invalid yaml", "utf-8")
        );

        await expect(serviceFactory.createNewService("my-new-service", true, "path/to/file.yaml")).rejects.toEqual(
            new Error("Unable to parse yaml file")
        );
    });

    it("raises error when file contains invalid keys", async () => {
        const newServiceSpecOverrides = {
            name: "my-new-service",
            type: {
                name: "MICROSERVICE"
            },
            invalidKey: "invalid",
            anotherInvalidKey: true
        };

        (fsMock.readFileSync as jest.Mock).mockReturnValue(
            Buffer.from(yaml.stringify(newServiceSpecOverrides), "utf-8")
        );

        buildServiceSpecMock.mockResolvedValue(newServiceSpec as never);

        await expect(serviceFactory.createNewService("my-new-service", true, "path/to/file.yaml")).rejects.toMatchSnapshot();
    });
});
