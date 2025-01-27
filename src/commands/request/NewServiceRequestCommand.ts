import { Args, Command, Config, Flags } from "@oclif/core";
import ServiceFactory from "../../run/ServiceFactory.js";
import { join, relative, resolve } from "path";
import ServiceSpecRepository from "../../run/service-factory/ServiceSpecRepository.js";
import os from "os";
import CONSTANTS from "../../model/Constants.js";

export default class NewServiceRequestCommand extends Command {

    static description = "Reqyuest a new service to be created";

    static args = {
        name: Args.string({
            name: "Service Name",
            description: "The name of the service to create",
            required: true
        })
    };

    static flags = {
        file: Flags.file({
            char: "F",
            name: "file",
            aliases: ["file"],
            description: "The file containing values for the new service spec",
            exists: true,
            multiple: false
        }),

        dryRun: Flags.boolean({
            char: "d",
            name: "dry-run",
            aliases: ["dry-run"],
            description: "Run the command without making any changes",
            allowNo: false
        })
    };

    private readonly serviceFactory: ServiceFactory;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        const serviceRepository = ServiceSpecRepository.create(
            join(os.tmpdir(), "new-service-specs"),
            CONSTANTS.COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME,
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_NAME,
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_BRANCH,
            CONSTANTS.NEW_SERVICE_SPECS_PATH
        );

        this.serviceFactory = new ServiceFactory(serviceRepository);
    }

    async run (): Promise<any> {
        const { args, flags } = await this.parse(NewServiceRequestCommand);

        await this.serviceFactory.createNewService(args.name, flags.dryRun, flags.file);
    }

}
