import { Args, Config } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";

export default class Disable extends AbstractStateModificationCommand {

    static description: string = "Removes a service from development mode";

    static args = {
        services: Args.string({
            name: "services",
            required: true,
            description: "names of services to be removed to development mode"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error, true);
        this.validArgumentHandler = this.handleValidService;
    }

    private async handleValidService (serviceName: string): Promise<void> {
        this.stateManager.excludeServiceFromLiveUpdate(serviceName);
        this.log(`Service "${serviceName}" is disabled`);
    }

}
