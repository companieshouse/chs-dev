import { serviceValidator } from "../../helpers/validator.js";
import { DependencyObjectType } from "../../model/DependencyGraph.js";
import Service from "../../model/Service.js";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";

/**
 * Abstract base class for dependency-related commands.
 *
 * Extends {@link AbstractStateModificationCommand} to provide common functionality for commands
 * that modify a specific dependency object type.
 *
 * @template DependencyObjectType - The type of dependency object this command operates on.
 */
export default abstract class AbstractDependencyCommand extends AbstractStateModificationCommand<DependencyObjectType> {

    protected dependencyObjectType: DependencyObjectType;
    protected logger: (msg: string) => void;

    /**
     * Constructs an instance of AbstractDependencyCommand.
     *
     * @param argv - Command line arguments.
     * @param config - Configuration object.
     * @param dependencyObjectType - The type of dependency object this command operates on (e.g., "service" or "system").
     */
    constructor (argv: string[], config: any, dependencyObjectType: DependencyObjectType) {
        super(argv, config, dependencyObjectType);

        this.dependencyObjectType = dependencyObjectType;
        this.logger = (msg: string) => this.log(msg);
        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error, true);
    }

    override async run (): Promise<any> {
        const { argv, flags } = await this.parseArgumentsAndFlags();
        this.flagValues = flags;

        if (argv.length === 0) {
            this.error(`${this.dependencyObjectType} not supplied`);
        }

        for (const argument of argv as string[]) {
            if (this.argumentValidationPredicate(argument)) {
                await this.validArgumentHandler(argument);
            }
        }

    }

    /**
     * Retrieves a service from the inventory by its name.
     *
     * Searches the `inventory.services` array for a service whose `name` property matches
     * the provided `serviceName`. Returns the matching `Service` instance if found.
     *
     * @param serviceName - The name of the service to retrieve.
     * @returns The `Service` object with the specified name, or `undefined` if not found.
     */
    protected getServiceByName (serviceName: string): Service {
        return this.inventory.services.find(item => item.name === serviceName) as Service;
    }

}
