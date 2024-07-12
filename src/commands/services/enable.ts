import { Args, Config } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";

export default class Enable extends AbstractStateModificationCommand {

    static description = "Enables the services and any dependencies for use within the Docker environment";

    static args = {
        services: Args.string({
            name: "services",
            required: true,
            description: "names of services to be added to development mode"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error);
        this.validArgumentHandler = this.handleValidService;
    }

    private async handleValidService (serviceName: string): Promise<void> {
        this.stateManager.includeService(serviceName);

        this.log(`Service "${serviceName}" is enabled`);
    }

}
