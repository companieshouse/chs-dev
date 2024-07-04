import { Command, Config } from "@oclif/core";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

type ArgumentValidationPredicate = (argument: string) => boolean;
type ValidArgumentHandler = (argument: string) => Promise<void>;

const defaultValidationPredicate = (_: string) => true;
const defaultValidArgumentHandler = (_: string) => Promise.reject(new Error("Command not configured correctly"));

export default abstract class AbstractStateModificationCommand extends Command {

    static strict = false;

    private readonly stateModificationObjectType: "service" | "module";

    protected readonly inventory: Inventory;
    protected readonly stateManager: StateManager;

    protected argumentValidationPredicate: ArgumentValidationPredicate = defaultValidationPredicate;
    protected validArgumentHandler: ValidArgumentHandler = defaultValidArgumentHandler;

    constructor (argv: string[], config: Config, stateModificationObjectType: "service" | "module") {
        super(argv, config);

        this.inventory = new Inventory(process.cwd(), config.cacheDir);
        this.stateManager = new StateManager(process.cwd());
        this.stateModificationObjectType = stateModificationObjectType;
    }

    async run (): Promise<any> {

        const { argv } = await this.parse(AbstractStateModificationCommand);

        if (argv.length === 0) {
            this.error(`${this.properStateModificationObjectType} not supplied`);

            return;
        }

        let runHook = false;

        for (const argument of argv as string[]) {
            if (this.argumentValidationPredicate(argument)) {
                await this.validArgumentHandler(argument);

                runHook = true;
            }
        }

        if (runHook) {
            this.config.runHook("generate-runnable-docker-compose", {});
        }
    }

    private get properStateModificationObjectType (): string {
        return `${this.stateModificationObjectType.substring(0, 1).toUpperCase()}${this.stateModificationObjectType.substring(1)}`;
    }

}
