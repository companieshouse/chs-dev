import { afterAll, expect, jest } from "@jest/globals";
import ServiceSpecRepository from "../../../src/run/service-factory/ServiceSpecRepository";
import { cloneRepo as cloneRepoMock, checkoutNewBranch as checkoutNewBranchMock, addToStage as addToStageMock, commit as commitMock, push as pushMock, checkoutExistingBranch as checkoutExistingBranchMock } from "../../../src/helpers/git";
import { readFileSync as readFileSyncMock, existsSync as existsSyncMock, writeFileSync as writeFileSyncMock, rmSync as rmSyncMock } from "fs";
import { join } from "path";
import yaml from "yaml";
import NewServiceSpec from "../../../src/model/NewServiceSpec";

jest.mock("../../../src/helpers/git");
jest.mock("fs");

describe("ServiceSpecRepository", () => {
    const localDirectory = "/tmp/new-service-reqs-12edt";
    const gitHubOrganisationName = "companieshouse";
    const repositoryName = "new-service-specs";
    const branchName = "main";
    const serviceSpecPath = "specs/";

    const serviceSpec: NewServiceSpec = {
        name: "example-service",
        description: "An example service",
        type: {
            name: "MICROSERVICE",
            language: "NODE"
        },
        configuration: {},
        ownership: {
            team: "My Team",
            service: "The Best Service"
        },
        sensitive: false,
        submission_details: {
            by: "Test User",
            github_username: "testUserch1234"
        }
    };

    let serviceSpecRepository: ServiceSpecRepository;

    beforeEach(() => {
        jest.resetAllMocks();

        serviceSpecRepository = new ServiceSpecRepository(
            localDirectory,
            gitHubOrganisationName,
            repositoryName,
            branchName,
            serviceSpecPath
        );
    });

    describe("load", () => {
        it("clones repository to local directory", async () => {
            await serviceSpecRepository.load();

            expect(cloneRepoMock).toHaveBeenCalledWith({
                repositoryUrl: `git@github.com:${gitHubOrganisationName}/${repositoryName}`,
                destinationPath: localDirectory,
                branch: branchName
            });
        });

        it("does not clone when permanent", async () => {
            const permanentServiceSpecRepository = new ServiceSpecRepository(
                "~/repos/services",
                "companieshouse-org",
                "services",
                "main",
                "repositories",
                true
            );

            await permanentServiceSpecRepository.load();

            expect(cloneRepoMock).not.toHaveBeenCalled();
        });

        it("checks out branch when permanent", async () => {

            const permanentServiceSpecRepository = new ServiceSpecRepository(
                "~/repos/services",
                "companieshouse-org",
                "services",
                "main",
                "repositories",
                true
            );

            await permanentServiceSpecRepository.load();

            expect(checkoutExistingBranchMock).toHaveBeenCalledWith(
                "~/repos/services",
                "main"
            );
        });
    });

    describe("initialise", () => {
        it("checks out branch", async () => {
            await serviceSpecRepository.initialise("feature/add-new-service-a");

            expect(checkoutNewBranchMock).toHaveBeenCalledWith(localDirectory, "feature/add-new-service-a");
        });

    });

    describe("get", () => {

        const serviceSpecYaml = yaml.stringify(serviceSpec);

        const yamlParseSpy = jest.spyOn(yaml, "parse");

        beforeEach(() => {
            jest.resetAllMocks();
            yamlParseSpy.mockReturnValue(serviceSpec);
        });

        it("checks whether local directory has been initialised first", async () => {
            (existsSyncMock as jest.MockedFunction<typeof existsSyncMock>).mockReturnValueOnce(true).mockReturnValue(false);

            await serviceSpecRepository.get("my-new-service");

            expect(existsSyncMock).toHaveBeenCalledWith(`${localDirectory}/${serviceSpecPath}`);
        });

        it("checks whether service exists", async () => {
            (existsSyncMock as jest.MockedFunction<typeof existsSyncMock>).mockReturnValueOnce(true).mockReturnValue(false);

            await serviceSpecRepository.get("my-new-service");

            expect(existsSyncMock).toHaveBeenCalledWith(
                join(localDirectory, serviceSpecPath, "my-new-service.yaml")
            );
        });

        it("resolves to undefined when initialised but service does not exist", async () => {
            (existsSyncMock as jest.MockedFunction<typeof existsSyncMock>).mockReturnValueOnce(true).mockReturnValue(false);

            await expect(serviceSpecRepository.get("my-new-service")).resolves.toBeUndefined();
        });

        it("parses the service spec when found", async () => {
            (readFileSyncMock as jest.MockedFunction<typeof readFileSyncMock>).mockReturnValue(
                Buffer.from(serviceSpecYaml, "utf-8")
            );

            (existsSyncMock as jest.MockedFunction<typeof existsSyncMock>).mockReturnValue(true);

            await serviceSpecRepository.get("my-new-service");

            expect(yamlParseSpy).toHaveBeenCalledWith(serviceSpecYaml);
        });

        it("returns parsed service spec when found", async () => {
            (readFileSyncMock as jest.MockedFunction<typeof readFileSyncMock>).mockReturnValue(
                Buffer.from(serviceSpecYaml, "utf-8")
            );

            (existsSyncMock as jest.MockedFunction<typeof existsSyncMock>).mockReturnValue(true);

            await expect(serviceSpecRepository.get("my-new-service")).resolves.toBe(serviceSpec);
        });

        it("throws error when not initialised", async () => {
            (existsSyncMock as jest.MockedFunction<typeof existsSyncMock>).mockReturnValue(false);

            await expect(serviceSpecRepository.get("new-service")).rejects
                .toEqual(new Error("Cannot get service specification from uninitialised repository."));

        });
    });

    describe("put", () => {
        const yamlStringifySpy = jest.spyOn(yaml, "stringify");

        beforeEach(() => {
            jest.resetAllMocks();
        });

        afterAll(() => {
            yamlStringifySpy.mockRestore();
        });

        it("stringifies service spec as yaml", async () => {
            await serviceSpecRepository.put(
                "my-new-service",
                serviceSpec
            );

            expect(yamlStringifySpy).toHaveBeenCalledWith(serviceSpec);
        });

        it("writes stringified yaml to service spec file", async () => {
            await serviceSpecRepository.put(
                "my-new-service",
                serviceSpec
            );

            expect(writeFileSyncMock).toHaveBeenCalledWith(
                join(
                    localDirectory,
                    serviceSpecPath,
                    "my-new-service.yaml"
                ),
                yaml.stringify(serviceSpec)
            );
        });

        it("adds the spec file to the git stage", async () => {
            await serviceSpecRepository.put(
                "my-new-service",
                serviceSpec
            );

            expect(addToStageMock).toHaveBeenCalledWith(
                localDirectory,
                join(serviceSpecPath, "my-new-service.yaml")
            );
        });

        it("resolves to the spec", async () => {
            await expect(serviceSpecRepository.put(
                "my-new-service",
                serviceSpec
            )).resolves.toBe(serviceSpec);
        });
    });

    describe("commitAndPush", () => {
        beforeEach(() => {
            jest.resetAllMocks();
        });

        it("commits the changes to the local repository", async () => {
            const commitMsg = "Added service spec for new service: service-one-two-three";

            await serviceSpecRepository.commitAndPush(commitMsg);

            expect(commitMock).toHaveBeenCalledWith(localDirectory, commitMsg);
        });

        it("pushes the local changes to remote", async () => {
            const commitMsg = "Added service spec for new service: service-one-two-three";

            await serviceSpecRepository.commitAndPush(commitMsg);

            expect(pushMock).toHaveBeenCalledWith(localDirectory);
        });
    });

    describe("close", () => {
        beforeEach(() => {
            jest.resetAllMocks();
        });

        it("removes the local directory", () => {
            serviceSpecRepository.close();

            expect(rmSyncMock).toHaveBeenCalledWith(
                localDirectory,
                {
                    force: true,
                    recursive: true
                }
            );
        });

        it("does not remove a local directory", () => {
            const permanentServiceSpecRepository = new ServiceSpecRepository(
                "~/repos/services",
                "companieshouse-org",
                "services",
                "main",
                "repositories",
                true
            );

            permanentServiceSpecRepository.close();

            expect(rmSyncMock).not.toHaveBeenCalled();
        });
    });
});

describe("create", () => {
    const originalProcessEnv = process.env;

    describe("CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY unset", () => {

        beforeEach(() => {
            if (typeof process.env.CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY !== "undefined") {
                delete process.env.CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY;
            }
        });

        afterAll(() => {
            process.env = originalProcessEnv;
        });

        it("sets directory to supplied", () => {
            expect(ServiceSpecRepository.create(
                "/tmp/services-repo",
                "companieshouse-org",
                "services",
                "main",
                "repositories/"
            // @ts-expect-error  testing private field
            ).localDirectory).toBe("/tmp/services-repo");
        });

        it("marks as not permanent", () => {
            expect(ServiceSpecRepository.create(
                "/tmp/services-repo",
                "companieshouse-org",
                "services",
                "main",
                "repositories/"
            // @ts-expect-error  testing private field
            ).isPermanent).toBe(false);

        });
    });

    describe("CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY set", () => {
        const chsDevNewServiceLocalDirectory = "~/repos/services";

        beforeEach(() => {
            process.env.CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY = chsDevNewServiceLocalDirectory;
        });

        afterAll(() => {
            process.env = originalProcessEnv;
        });

        it("sets directory to env var", () => {
            expect(ServiceSpecRepository.create(
                "/tmp/services-repo",
                "companieshouse-org",
                "services",
                "main",
                "repositories/"
            // @ts-expect-error  testing private field
            ).localDirectory).toBe(chsDevNewServiceLocalDirectory);
        });

        it("marks as permanent", () => {
            expect(ServiceSpecRepository.create(
                "/tmp/services-repo",
                "companieshouse-org",
                "services",
                "main",
                "repositories/"
            // @ts-expect-error  testing private field
            ).isPermanent).toBe(true);

        });
    });

});
