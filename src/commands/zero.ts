import { Command, Config } from "@oclif/core";
import { StateManager } from "../state/state-manager.js";
import loadConfig from "../helpers/config-loader.js";

export default class Zero extends Command {

    static description = "Disables all enabled modules and services. Services in development mode and excluded services are left unchanged";

    static examples = [
        {
            description: "Disable all enabled modules and services",
            command: "$ <%= config.bin %> <%= command.id %>"
        }
    ];

    private readonly stateManager: StateManager;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.stateManager = new StateManager(loadConfig().projectPath);
    }

    async run (): Promise<void> {
        const { modules = [], services = [] } = this.stateManager.snapshot;

        if (modules.length === 0 && services.length === 0) {
            this.log("No modules or services are enabled - nothing to disable");
            return;
        }

        this.stateManager.clearModules();
        this.stateManager.clearServices();

        await this.config.runHook("generate-runnable-docker-compose", {});

        modules.forEach(moduleName => this.log(`Module "${moduleName}" is disabled`));
        services.forEach(serviceName => this.log(`Service "${serviceName}" is disabled`));
    }
}
