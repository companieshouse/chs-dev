import { Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";
import loadConfig from "../../helpers/config-loader.js";
import ChsDevConfig from "../../model/Config.js";
import DependencyDiagram from "../../run/dependency/dependency-diagram.js";
import { DependencyObjectType } from "../../model/DependencyGraph.js";

/**
 * Command to generate a system-wide dependency diagram.
 * This command allows users to visualize the dependencies of all services
 * in a CHS Dev project as a single system diagram.
 * @example
 * chs-dev dependency system
 */
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
        this.diagram = new DependencyDiagram(DependencyObjectType.SYSTEM, logger);
    }

    async run (): Promise<any> {
        this.diagram.createSystemDiagram(this.inventory);
    }
}
