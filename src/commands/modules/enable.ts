import { Args, Config } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { moduleValidator } from "../../helpers/validator.js";

export default class Enable extends AbstractStateModificationCommand {

    static description = "Enables the services within the supplied modules";

    static args = {
        modules: Args.string({
            name: "modules",
            required: true,
            description: "list of module names"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "module");

        this.argumentValidationPredicate = moduleValidator(this.inventory, this.error);
        this.validArgumentHandler = this.handleValidModule;
    }

    protected async handlePostHookCall (commandArgv: string[]): Promise<void> {
        this.handleServiceModuleStateHook({ topic: "modules" });
    }

    private handleValidModule (moduleName: string): Promise<void> {
        this.stateManager.includeModule(moduleName);

        this.log(`Module "${moduleName}" is enabled`);

        return Promise.resolve();
    }
}
