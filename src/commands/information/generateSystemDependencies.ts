import { Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";
import loadConfig from "../../helpers/config-loader.js";
import ChsDevConfig from "../../model/Config.js";
import DependencyDiagram from "../../information/SystemDependencyDiagram.js";

export default class GenerateSystemDependencyDiagrams extends Command {

    static description: string = "Generates a System dependency Diagram";

    protected readonly inventory: Inventory;
    private tree: DependencyDiagram;
    protected chsDevConfig: ChsDevConfig;

    constructor (argv: string[], config: Config) {
        super(argv, config,);
        this.chsDevConfig = loadConfig();
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.tree = new DependencyDiagram(this.inventory);
    }

    async run (): Promise<any> {
        this.tree.createSystemDiagram();
    }
}
