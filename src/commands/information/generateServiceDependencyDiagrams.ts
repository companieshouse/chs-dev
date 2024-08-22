import { Args, Config } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";
import { Inventory } from "../../state/inventory.js";
import loadConfig from "../../helpers/config-loader.js";
import DependencyDiagram from "../../information/service/DependencyDiagram.js";

export default class GenerateServiceDependencyDiagrams extends AbstractStateModificationCommand {
    static description: string = "Generates a dependency Diagram for the specified service(s)";

    protected readonly inventory: Inventory;
    private diagram: DependencyDiagram;

    static args = {
        services: Args.string({
            name: "services",
            required: true,
            description: "names of services to be graphed"
        })
    };

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");
        this.chsDevConfig = loadConfig();
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.diagram = new DependencyDiagram(this.inventory);
        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error, true);
        this.validArgumentHandler = this.handleValidService;
    }

    private async handleValidService (serviceName: string): Promise<void> {
        this.diagram.createDependencyDiagrams(serviceName);
    }
}
