import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";
import { Inventory } from "../../state/inventory.js";
import loadConfig from "../../helpers/config-loader.js";
import DependencyDiagram from "../../information/service/DependencyDiagram.js";
import { Command, Config, Args, Flags, Parser } from "@oclif/core";
import DependencyTree from "../../information/service/dependencyTree.js";

export default class GenerateServiceDependencyDiagrams extends AbstractStateModificationCommand {
    static description: string = "Generates a dependency diagram / tree for the specified service(s)";

    protected readonly inventory: Inventory;
    private diagram: DependencyDiagram;
    private tree: DependencyTree;

    static args = {
        services: Args.string({
            name: "services",
            required: true,
            description: "names of services to be graphed"
        })
    };

    static flags = {
        type: Flags.string({
            char: "t",
            aliases: ["type"],
            summary: "diagram / tree",
            required: true
        }),
    };

    constructor (argv: string[], config: Config) { 
        super(argv, config, "service");
        this.chsDevConfig = loadConfig();
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.diagram = new DependencyDiagram(this.inventory);
        this.tree = new DependencyTree(this.inventory);
        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error, true);
        this.validArgumentHandler = this.handleValidService;
    }

    protected override parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(GenerateServiceDependencyDiagrams);
    }

    private async handleValidService (serviceName: string): Promise<void> {

        if (this.flagValues !== undefined){
            const type = this.flagValues?.type || null;
        
            if (type === "tree" ){
                this.tree.generateTree(serviceName);
            }
            if (type === "flattree" ){
                this.tree.generateFlatTree(serviceName);
            }
            else if (type === "diagram" ){
                this.diagram.createDependencyDiagrams(serviceName);
            }else {
                console.error(`'${type}' is not a valid value`);
            }
        }
    }
}
