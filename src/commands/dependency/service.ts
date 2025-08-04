import { Args, Config, Flags } from "@oclif/core";
import AbstractDependencyCommand from "./AbstractDependencyCommand.js";
import DependencyDiagram from "../../run/dependency/dependency-diagram.js";
import DependencyTree from "../../run/dependency/dependency-tree.js";

export default class Service extends AbstractDependencyCommand {
    static description: string = "Generates a dependency diagram / tree for the specified service(s)";

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
            summary: "diagram / tree / flattree",
            required: true
        })
    };

    private diagram: DependencyDiagram;
    private tree: DependencyTree;

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");
        this.validArgumentHandler = this.handleValidService;

        this.diagram = new DependencyDiagram(this.logger, this.getServiceByName.bind(this));
        this.tree = new DependencyTree(this.logger, this.getServiceByName.bind(this));

    }

    protected override parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(Service);
    }

    private async handleValidService (serviceName: string): Promise<void> {

        if (this.flagValues !== undefined) {
            const type = this.flagValues?.type || null;

            if (type === "tree") {
                this.tree.generateTree(serviceName);
            } else if (type === "flattree") {
                this.tree.generateFlatTree(serviceName);
            } else if (type === "diagram") {
                this.diagram.createDependencyDiagrams(serviceName);
            } else {
                this.error(`'${type}' is not a valid value`);
            }
        }
    }
}
