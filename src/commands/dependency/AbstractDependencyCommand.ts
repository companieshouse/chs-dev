import { serviceValidator } from "../../helpers/validator.js";
import Service from "../../model/Service.js";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";

type DependencyObjectType = "service" | "system";

export default abstract class AbstractDependencyCommand extends AbstractStateModificationCommand<DependencyObjectType> {

    protected dependencyObjectType: DependencyObjectType;
    protected logger: (msg: string) => void;

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

    protected getServiceByName (serviceName: string): Service {
        return this.inventory.services.find(item => item.name === serviceName) as Service;
    }

}
