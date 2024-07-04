import { Args, Config } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";

export default class Disable extends AbstractStateModificationCommand {

    static description = "Removes the supplied services and any unnecessary dependencies from the Docker environment";

    static args = {
        services: Args.string({
            name: "services",
            required: true,
            description: "names of services to be removed to docker environment"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error);
        this.validArgumentHandler = this.handleValidService;
    }

    private async handleValidService (serviceName: string): Promise<void> {
        this.stateManager.excludeService(serviceName);

        this.log(`Service "${serviceName}" is disabled`);
    }

}
