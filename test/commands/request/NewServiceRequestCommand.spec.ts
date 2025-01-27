import { expect, jest } from "@jest/globals";
import NewServiceRequestCommand from "../../../src/commands/request/NewServiceRequestCommand";
import { Config } from "@oclif/config";
import ServiceSpecRepository from "../../../src/run/service-factory/ServiceSpecRepository";
import { join } from "path";
import { tmpdir } from "os";
import CONSTANTS from "../../../src/model/Constants";
import NewServiceSpec from "../../../src/model/NewServiceSpec";
import ServiceFactory from "../../../src/run/ServiceFactory";

jest.mock("../../../src/run/ServiceFactory");
jest.mock("../../../src/run/service-factory/ServiceSpecRepository");

const repositoryCreateMock = jest.fn();

const serviceFactoryMock = {
    createNewService: jest.fn()
};

describe("NewServiceRequestCommand", () => {
    let command: NewServiceRequestCommand;
    let parseSpy;

    beforeEach(() => {
        jest.resetAllMocks();

        (ServiceFactory as jest.Mock).mockReturnValue(serviceFactoryMock);

        ServiceSpecRepository.create = repositoryCreateMock as (
            d: string,
            g: string,
            r: string,
            b: string,
            p: string
        ) => ServiceSpecRepository;

        // @ts-expect-error
        command = new NewServiceRequestCommand([], {} as Config);

        // @ts-expect-error
        parseSpy = jest.spyOn(command, "parse");
    });

    it("initialises repository correctly", () => {
        expect(repositoryCreateMock).toHaveBeenCalledWith(
            join(tmpdir(), "new-service-specs"),
            CONSTANTS.COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME,
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_NAME,
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_BRANCH,
            CONSTANTS.NEW_SERVICE_SPECS_PATH
        );
    });

    it("creates new service with name requested", async () => {
        parseSpy.mockResolvedValue({ args: { name: "my-new-service" }, flags: {} });

        await command.run();

        expect(serviceFactoryMock.createNewService).toHaveBeenCalledWith(
            "my-new-service", undefined, undefined
        );
    });

    it("runs in dry run mode when requested", async () => {
        parseSpy.mockResolvedValue({
            args: { name: "my-new-service" },
            flags: { dryRun: true }
        });

        await command.run();

        expect(serviceFactoryMock.createNewService).toHaveBeenCalledWith(
            "my-new-service",
            true,
            undefined
        );
    });

    it("adds file when provided", async () => {
        parseSpy.mockResolvedValue({
            args: { name: "my-new-service" },
            flags: { file: "my-file.yaml" }
        });

        await command.run();

        expect(serviceFactoryMock.createNewService).toHaveBeenCalledWith(
            "my-new-service",
            undefined,
            "my-file.yaml"
        );
    });
});
