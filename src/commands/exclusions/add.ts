import { Args, Config } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";

export default class Add extends AbstractStateModificationCommand {

    static description = "Adds a new service to the exclusions list";

    static aliases = ["exclude"];

    static args = {
        service: Args.string({
            name: "excluded-service",
            required: true,
            description: "name of service being excluded from the docker environment"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error);
        this.validArgumentHandler = this.handleValidService;
    }

    private handleValidService (serviceName: string): Promise<void> {
        this.stateManager.addExclusionForService(serviceName);

        this.log(`Service "${serviceName}" is excluded`);

        return Promise.resolve();
    }
}
