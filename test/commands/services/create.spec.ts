import { expect, jest } from "@jest/globals";
import Create from "../../../src/commands/services/create";
import { Config } from "@oclif/core";
import ServiceFactoryMock from "../../../src/run/service-factory";
import configLoaderMock from "../../../src/helpers/config-loader";
import { serviceValidator as serviceValidatorMock } from "../../../src/helpers/validator";

jest.mock("../../../src/run/service-factory");
jest.mock("../../../src/state/inventory");
jest.mock("../../../src/helpers/config-loader");
jest.mock("../../../src/helpers/validator");

describe("Create", () => {
    const parseMock = jest.fn();
    const serviceFactoryMock = {
        createNewBasedOn: jest.fn()
    };

    const validatorMock = jest.fn();

    let create: Create;
    let configMock: Config;

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        configMock = {
            cacheDir: "./caches"
        };

        // @ts-expect-error
        ServiceFactoryMock.mockReturnValue(serviceFactoryMock);

        // @ts-expect-error
        configLoaderMock.mockReturnValue({
            projectPath: "/home/test-user/docker-project/"
        });

        // @ts-expect-error
        serviceValidatorMock.mockReturnValue(validatorMock);

        create = new Create([], configMock);

        // @ts-expect-error
        create.parse = parseMock;

        validatorMock.mockReturnValue(true);
    });

    it("validates source service", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                repoName: "new-service",
                module: "word"
            },
            flags: {
                from: "service-one",
                containerName: "new-container",
                descriptionLabel: "Description of the chs service",
                traefikRuleLabel: "Host('chs.local')",
                traefikPrioityLabel: "4",
                gitHubRepoBranchName: "develop"
            }
        });

        await create.run();

        expect(validatorMock).toHaveBeenCalledWith("service-one");
    });

    it("can pass all information to service factory", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                repoName: "new-service",
                module: "word"
            },
            flags: {
                from: "service-one",
                containerName: "new-container",
                descriptionLabel: "Description of the chs service",
                traefikRuleLabel: "Host('chs.local')",
                traefikPrioityLabel: "4",
                gitHubRepoBranchName: "develop"
            }
        });

        await create.run();

        expect(serviceFactoryMock.createNewBasedOn).toHaveBeenCalledWith(
            "service-one", {
                gitHubRepoName: "new-service",
                moduleName: "word",
                containerName: "new-container",
                descriptionLabel: "Description of the chs service",
                traefikRuleLabel: "Host('chs.local')",
                traefikPriorityLabel: "4",
                gitHubRepoBranchName: "develop"
            }
        );
    });

    it("can pass minimal information to service factory", async () => {
        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                repoName: "new-service-b"
            },
            flags: {
                from: "service-two"
            }
        });

        await create.run();

        expect(serviceFactoryMock.createNewBasedOn).toHaveBeenCalledWith(
            "service-two", {
                gitHubRepoName: "new-service-b"
            }
        );
    });

    it("errors when the service supplied in from is invalid", async () => {
        validatorMock.mockReturnValue(false);

        // @ts-expect-error
        parseMock.mockResolvedValue({
            args: {
                repoName: "new-service-b"
            },
            flags: {
                from: "service-two"
            }
        });

        await expect(create.run()).rejects.toBeDefined();
    });
});
