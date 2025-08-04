import { Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";
import loadConfig from "../../helpers/config-loader.js";
import ChsDevConfig from "../../model/Config.js";
import DependencyDiagram from "../../run/dependency/dependency-diagram.js";

export default class System extends Command {

    static description: string = "Generates a System dependency Diagram";

    protected readonly inventory: Inventory;
    private diagram: DependencyDiagram;
    protected chsDevConfig: ChsDevConfig;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        this.chsDevConfig = loadConfig();
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        const logger = (msg: string) => this.log(msg);
        this.diagram = new DependencyDiagram(logger);
    }

    async run (): Promise<any> {
        this.diagram.createSystemDiagram(this.inventory);
    }
}
