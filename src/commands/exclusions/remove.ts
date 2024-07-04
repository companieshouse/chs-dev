import { Args, Config } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";

export default class Remove extends AbstractStateModificationCommand {

    static description = "Removes an exclusion for a service.";

    static aliases = ["include"];

    static args = {
        service: Args.string({
            name: "excluded-service",
            required: true,
            description: "name of service being reincluded in the docker environment"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error);
        this.validArgumentHandler = this.handleValidService;
    }

    private handleValidService (serviceName: string): Promise<void> {
        this.stateManager.removeExclusionForService(serviceName);

        this.log(`Service "${serviceName}" is included (previous exclusion removed)`);

        return Promise.resolve();
    }
}
