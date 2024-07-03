import { Args, Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";
import { StateManager } from "../../state/state-manager.js";
import { serviceValidator } from "../../helpers/service-validator.js";
import Service from "../../model/Service.js";

/**
 * A base class for all service specific commands within the Development
 * topic allowing common service behaviours
 */
export default abstract class AbstractDevelopmentServiceCommand extends Command {
    // Set strict = false to allow rest args for listing services
    static strict = false;

    protected static action: string;

    static args = {
        services: Args.string({
            name: "services",
            description: `list of services to ${AbstractDevelopmentServiceCommand.action} in development mode`,
            required: true

        })
    };

    protected readonly inventory: Inventory;
    protected readonly stateManager: StateManager;
    protected readonly serviceNameValidator: (serviceName: string) => boolean;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.inventory = new Inventory(process.cwd(), config.cacheDir);
        this.stateManager = new StateManager(process.cwd());
        this.serviceNameValidator = serviceValidator(this.inventory, this.error);
    }

    /**
     * The base class will take care of validating the input - it will expect
     * at least one service name to be provided. Implementations must provide
     * an implementation of how to handle a valid service
     * @param serviceName - name of the service being interacted with
     */
    protected abstract handleValidService(serviceName: string): Promise<boolean>;

    async run (): Promise<any> {
        const { argv } = await this.parse(AbstractDevelopmentServiceCommand);

        // Check that a service has been provided otherwise exit
        if (argv.length === 0) {
            this.error("Service not supplied");

            return;
        }

        let runHook = false;

        // Validate each service before handling the valid services
        for (const serviceName of argv as string[]) {
            if (this.serviceNameValidator(serviceName) && this.serviceHasRepositoryDefined(serviceName)) {
                runHook = await this.handleValidService(serviceName);
            }
        }

        // Run the generate-runnable-docker-compose hook when a service was changed
        if (runHook) {
            await this.config.runHook("generate-runnable-docker-compose", {});
        }
    }

    private serviceHasRepositoryDefined (serviceName: string) {
        const service = this.inventory.services.find(potential => potential.name === serviceName) as Service;

        if (service?.repository === null || service?.repository === undefined) {
            this.error(`Service "${serviceName}" does not have repository defined`);
            return false;
        }

        return true;
    }

}
