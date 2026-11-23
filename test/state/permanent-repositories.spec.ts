import { expect, jest } from "@jest/globals";
import { cloneRepo as cloneRepoMock, updateRepo as updateRepoMock } from "../../src/helpers/git";
import fs from "fs";
import Service from "../../src/model/Service";
import yaml from "yaml";
import { PermanentRepositories } from "../../src/state/permanent-repositories";
import Config from "../../src/model/Config";
import { Inventory } from "../../src/state/inventory";
import { join } from "path";

jest.mock("../../src/helpers/git");

const serviceOne = {
    name: "service-one",
    module: "module-one",
    source: "services/modules/module-one/service-one.docker-compose.yaml",
    dependsOn: [],
    repository: {
        url: "git@github.com:companieshouse/repo1.git"
    },
    builder: "",
    metadata: {
        repositoryRequired: "true"
    }
};
const serviceTwo = {
    name: "service-two",
    module: "module-one",
    source: "services/modules/module-one/service-two.docker-compose.yaml",
    dependsOn: [],
    repository: {
        url: "git@github.com:companieshouse/repo2.git"
    },
    builder: "",
    metadata: {}
};
const serviceThree = {
    name: "service-three",
    module: "module-one",
    source: "services/modules/module-one/service-three.docker-compose.yaml",
    dependsOn: [],
    repository: {
        url: "git@github.com:companieshouse/repo3.git",
        branch: "develop"
    },
    builder: "",
    metadata: {
        repositoryRequired: "true"
    }
};
const serviceFour = {
    name: "service-four",
    module: "module-two",
    source: "services/modules/module-two/service-four.docker-compose.yaml",
    dependsOn: [],
    repository: {
        url: "git@github.com:companieshouse/repo4.git"
    },
    builder: "",
    metadata: {}
};
const serviceFive = {
    name: "service-five",
    module: "module-two",
    source: "services/modules/module-one/service-five.docker-compose.yaml",
    dependsOn: [],
    repository: null,
    builder: "",
    metadata: {
        repositoryRequired: "true"
    }
};

const services: Service[] = [
    serviceOne,
    serviceTwo,
    serviceThree,
    serviceFour,
    serviceFive
];

const inventoryMock = {
    services
};

const config: Config = {
    projectName: "chs-docker",
    projectPath: "./chs-docler",
    env: {}
};

const dockerComposeConfigurationIncludingServices = (...services: Service[]) => {
    const dockerComposeConfiguration = {
        services: {},
        include: services.map(service => service.source)
    };

    return yaml.stringify(dockerComposeConfiguration);
};

describe("PermanentRepositories", () => {
    const readFileSyncMock = jest.spyOn(fs, "readFileSync");
    const existsSyncMock = jest.spyOn(fs, "existsSync");

    let permanentRepositories: PermanentRepositories;

    beforeEach(() => {
        jest.resetAllMocks();

        permanentRepositories = new PermanentRepositories(config, inventoryMock as Inventory);

        readFileSyncMock.mockReturnValue(
            Buffer.from(dockerComposeConfigurationIncludingServices(serviceOne), "utf8")
        );
    });

    it("reads in the docker compose spec", async () => {
        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValue(false);

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(readFileSyncMock).toHaveBeenCalledWith(join(config.projectPath, "docker-compose.yaml"));
    });

    it("it checks whether permanent repository exists", async () => {
        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValue(false);

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(existsSyncMock).toHaveBeenCalledWith(join(config.projectPath, "repositories", "repo1"));
    });

    it("clones repo when permanent repo has not be cloned", async () => {
        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValue(false);

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).toHaveBeenCalledWith({
            repositoryUrl: serviceOne.repository.url,
            destinationPath: join(config.projectPath, "repositories", "repo1")
        });
    });

    it("clones repo with branch when permanent repo specifies branch", async () => {
        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValue(false);

        readFileSyncMock.mockReturnValue(
            Buffer.from(dockerComposeConfigurationIncludingServices(serviceThree), "utf8")
        );

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).toHaveBeenCalledWith({
            repositoryUrl: serviceThree.repository.url,
            destinationPath: join(config.projectPath, "repositories", "repo3"),
            branch: serviceThree.repository.branch
        });
    });

    it("Does not update repo when does not need to as it is newly cloned", async () => {
        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValue(false);

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(updateRepoMock).not.toHaveBeenCalled();
    });

    it("does not clone repo when local repo already exists", async () => {
        existsSyncMock.mockReturnValue(true);

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).not.toHaveBeenCalled();
    });

    it("updates repo when local repo already exists", async () => {
        existsSyncMock.mockReturnValue(true);

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(updateRepoMock).toHaveBeenCalledWith(
            join(config.projectPath, "repositories", "repo1")
        );
    });

    it("updates repo of a service without the repositoryRequired label", async () => {
        existsSyncMock.mockReturnValue(true);

        readFileSyncMock.mockReturnValue(
            Buffer.from(dockerComposeConfigurationIncludingServices(serviceTwo), "utf8")
        );

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).not.toHaveBeenCalled();
        expect(updateRepoMock).toHaveBeenCalledWith(
            join(config.projectPath, "repositories", "repo2")
        );
    });

    it("skips, with a warning, a repo which fails to update and carries on", async () => {
        existsSyncMock.mockReturnValue(true);
        const warnMock = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        (updateRepoMock as jest.Mock<any>).mockRejectedValueOnce(new Error("local changes would be overwritten"));

        readFileSyncMock.mockReturnValue(
            Buffer.from(dockerComposeConfigurationIncludingServices(serviceOne, serviceTwo), "utf8")
        );

        await expect(permanentRepositories.ensureAllExistAndAreUpToDate()).resolves.toBeUndefined();

        expect(updateRepoMock).toHaveBeenCalledTimes(2);
        expect(warnMock).toHaveBeenCalledWith("Skipped updating repo1: local changes would be overwritten");
        warnMock.mockRestore();
    });

    it("does not do anything for a service without a repository", async () => {
        existsSyncMock.mockReturnValue(true);

        readFileSyncMock.mockReturnValue(
            Buffer.from(dockerComposeConfigurationIncludingServices(serviceFive), "utf8")
        );

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).not.toHaveBeenCalled();

        expect(updateRepoMock).not.toHaveBeenCalled();
    });

    it("can handle multiple services", async () => {
        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValueOnce(true)
            .mockReturnValue(false);

        readFileSyncMock.mockReturnValue(
            Buffer.from(dockerComposeConfigurationIncludingServices(
                serviceOne,
                serviceTwo,
                serviceThree,
                serviceFour
            ), "utf8")
        );

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).toHaveBeenCalledTimes(3);
        expect(updateRepoMock).toHaveBeenCalledTimes(1);
    });

    it("clones, without updating, the repo of a service without the repositoryRequired label", async () => {
        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValue(false);

        readFileSyncMock.mockReturnValue(
            Buffer.from(dockerComposeConfigurationIncludingServices(serviceTwo), "utf8")
        );

        await permanentRepositories.ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).toHaveBeenCalledWith({
            repositoryUrl: serviceTwo.repository.url,
            destinationPath: join(config.projectPath, "repositories", "repo2")
        });
    });

    it("clones once a repository shared by several services, into the folder named after the repository", async () => {
        const shared = "git@github.com:companieshouse/eric.git";
        const eric = { ...serviceTwo, name: "eric", repository: { url: shared } };
        const ericWeb = { ...serviceTwo, name: "eric-web", repository: { url: shared } };
        const redis = { ...serviceTwo, name: "redis", module: "infrastructure", repository: null };
        const sharedServices = [eric, ericWeb, redis];

        existsSyncMock.mockReturnValueOnce(true)
            .mockReturnValue(false);
        readFileSyncMock.mockReturnValue(
            Buffer.from(yaml.stringify({ include: ["services/modules/module-one/service-two.docker-compose.yaml"] }), "utf8")
        );

        await new PermanentRepositories(config, { services: sharedServices } as unknown as Inventory).ensureAllExistAndAreUpToDate();

        expect(cloneRepoMock).toHaveBeenCalledTimes(1);
        expect(cloneRepoMock).toHaveBeenCalledWith({
            repositoryUrl: shared,
            destinationPath: join(config.projectPath, "repositories", "eric")
        });
    });

    it("rejects if docker-compose.yaml file does not exist", async () => {
        existsSyncMock.mockReturnValue(false);

        await expect(permanentRepositories.ensureAllExistAndAreUpToDate()).rejects.toEqual(
            new Error("No services enabled - could not find docker compose spec file. Enable a service and try again")
        );
    });
});
