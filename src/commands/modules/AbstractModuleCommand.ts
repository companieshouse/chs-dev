import { Args, Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";
import { StateManager } from "../../state/state-manager.js";

export default abstract class AbstractModuleCommand extends Command {

    static strict = false;

    static args = {
        modules: Args.string({
            name: "modules",
            required: true,
            description: "List of modules"
        })
    };

    protected readonly inventory: Inventory;
    protected readonly stateManager: StateManager;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.inventory = new Inventory(process.cwd(), config.cacheDir);
        this.stateManager = new StateManager(process.cwd());
    }

    protected abstract handleValidModule(moduleName: string): void;

    async run (): Promise<any> {

        const { argv } = await this.parse(AbstractModuleCommand);

        if (argv.length === 0) {
            this.error("Module not supplied");

            return;
        }

        let runHook = false;

        for (const moduleName of argv as string[]) {
            if (this.validateModule(moduleName)) {
                this.handleValidModule(moduleName);

                runHook = true;
            }
        }

        if (runHook) {
            this.config.runHook("generate-runnable-docker-compose", {});
        }
    }

    private validateModule (moduleName?: string): boolean {
        if (moduleName === null || moduleName === undefined) {
            this.error("Module must be provided");
            return false;
        }
        if (!this.inventory.modules.map(module => module.name).includes(moduleName)) {
            this.error(`Module "${moduleName}" is not defined in inventory`);
            return false;
        }
        return true;
    }

}
