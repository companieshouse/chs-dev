import { Command, Config } from "@oclif/core";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import ChsDevConfig from "../model/Config.js";
import loadConfig from "../helpers/config-loader.js";
import { ServiceLoader } from "../run/service-loader.js";
import { Plugin } from "@oclif/core/lib/interfaces/plugin.js";

type ServiceModuleStateHook = {
    topic: string
    commandArgv?: string[]
}
type Failure = {
    plugin: Plugin;
    error: Error;
};

type Success = {
    plugin: Plugin;
    result: string;
};
type HookResult = {
    failures: Failure[];
    successes: Success[];
};
type ArgumentValidationPredicate = (argument: string) => boolean;
type ValidArgumentHandler = (argument: string) => Promise<void>;
type PreHookCheck = (argument: string[]) => Promise<string | undefined>;

const defaultValidationPredicate = (_: string) => true;
const defaultValidArgumentHandler = (_: string) => Promise.reject(new Error("Command not configured correctly"));
const defaultPrehookCheck = async (argument: string[]) => Promise.resolve(undefined);

export default abstract class AbstractStateModificationCommand extends Command {

    static strict = false;

    private readonly stateModificationObjectType: "service" | "module";

    protected readonly inventory: Inventory;
    protected readonly stateManager: StateManager;
    protected readonly serviceLoader: ServiceLoader;

    protected argumentValidationPredicate: ArgumentValidationPredicate = defaultValidationPredicate;
    protected validArgumentHandler: ValidArgumentHandler = defaultValidArgumentHandler;
    protected preHookCheckWarnings?: PreHookCheck = defaultPrehookCheck;
    protected chsDevConfig: ChsDevConfig;

    protected flagValues: Record<string, any> | undefined = undefined;

    constructor (argv: string[], config: Config, stateModificationObjectType: "service" | "module") {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.stateModificationObjectType = stateModificationObjectType;
        this.serviceLoader = new ServiceLoader(this.inventory);
    }

    async run (): Promise<any> {

        const { argv, flags } = await this.parseArgumentsAndFlags();

        this.flagValues = flags;

        if (argv.length === 0) {
            this.error(`${this.properStateModificationObjectType} not supplied`);

            return;
        }

        let runHook = false;

        // Perform a pre-hook check on the state for commands that require it,
        // such as enabling dev mode or adding services to the exclusion list.
        // Prevents command execution if the pre-hook check returns an error or warning.
        const preCheckWarnings = this.preHookCheckWarnings ? await this.preHookCheckWarnings(argv as string[]) : undefined;

        const hasNoPreCheckWarnings = typeof preCheckWarnings === "undefined";

        if (hasNoPreCheckWarnings) {
            for (const argument of argv as string[]) {
                if (this.argumentValidationPredicate(argument)) {
                    await this.validArgumentHandler(argument);

                    runHook = true;
                }
            }

            if (runHook) {
                const state = this.stateManager.snapshot;
                const { excludedServices = [] } = state || {};

                const generateExclusionSpec = this.handleExclusionsAndDevelopmentCommand(this.id, excludedServices);

                await this.config.runHook("generate-runnable-docker-compose", {
                    generateExclusionSpec: generateExclusionSpec ? true : undefined
                });

                await this.handlePostHookCall(argv as string[]);
            }
        }

    }

    protected parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(AbstractStateModificationCommand);
    }

    /**
    * Executes post-hook calls after running a command.
    *
    * @param {string[]} _ - The arguments passed to the command.
    * @returns {Promise< void>} - `void`.
     */
    protected async handlePostHookCall (_: string[]): Promise<void> { }

    /**
     * Handles the execution of the "check-service-or-module-state" hook by passing the activated services,
     * command details, and topic to the hook, then processes the hook's response.
     *
     * @param {ServiceModuleStateHook} param - An object containing the hook topic and command arguments.
     * @param {string} param.topic - The topic related to the service or module state.
     * @param {string[]} param.commandArgv - The arguments passed to the command.
     * @returns {Promise<string[]>} - Returns a processed array of responses from the executed hook.
     */
    protected async handleServiceModuleStateHook ({ topic, commandArgv }: ServiceModuleStateHook): Promise<string | undefined> {
        const activatedServices = this.handleActivatedServicesByName();
        const result = await this.config.runHook("check-service-or-module-state", {
            activatedServices,
            topic,
            command: this.id?.split(":")[1],
            commandArgv
        });
        return this.handleHookResponse(result);
    }

    /**
     * Fetches both manually and automatically activated servicesNames,
     * by filtering state against the inventory object
     *
     * @returns A list of activated servicesNames
     */
    protected handleActivatedServicesByName (): string[] {
        const state = this.stateManager.snapshot;
        const enabledServiceNames = new ServiceLoader(this.inventory);
        return enabledServiceNames.loadServicesNames(state);
    }

    private handleHookResponse (result: HookResult): string | undefined {
        return result.successes[0].result;
    }

    private get properStateModificationObjectType (): string {
        return `${this.stateModificationObjectType.substring(0, 1).toUpperCase()}${this.stateModificationObjectType.substring(1)}`;
    }

    private handleExclusionsAndDevelopmentCommand (id: string | undefined, excludedServices: string[]): boolean {
        let result = false;
        if (id) {
            const inExclusionMode = (/^exclusions:(add|remove)$/).test(id);
            const inDevelopmentMode = (/^development:(enable|disable)$/).test(id);
            const hasExcludedServices = excludedServices.length > 0;
            result = inExclusionMode || (hasExcludedServices && inDevelopmentMode);
        }
        return result;

    }

}
