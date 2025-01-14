import { Command, Config } from "@oclif/core";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import ChsDevConfig from "../model/Config.js";
import loadConfig from "../helpers/config-loader.js";

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
    protected chsDevConfig: ChsDevConfig;

    protected flagValues: Record<string, any> | undefined = undefined;

    constructor (argv: string[], config: Config, stateModificationObjectType: "service" | "module") {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.stateModificationObjectType = stateModificationObjectType;
    }

    async run (): Promise<any> {

        const { argv, flags } = await this.parseArgumentsAndFlags();

        this.flagValues = flags;

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
            const state = this.stateManager.snapshot;
            const { excludedServices } = state || [];

            if (this.id?.match(/^exclusions:(add|remove)$/) ||
                (excludedServices.length && this.id?.match(/^development:(enable|disable)$/))) {
                await this.config.runHook("generate-exclusion-docker-compose", {});
            } else {
                await this.config.runHook("generate-runnable-docker-compose", {});
            }

            await this.handlePostHookCall(argv as string[]);
        }
    }

    protected parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(AbstractStateModificationCommand);
    }

    protected async handlePostHookCall (_: string[]): Promise<void> {}

    private get properStateModificationObjectType (): string {
        return `${this.stateModificationObjectType.substring(0, 1).toUpperCase()}${this.stateModificationObjectType.substring(1)}`;
    }

}
