import { Args, Config, Flags } from "@oclif/core";
import DependencyDiagram from "../../run/dependency/dependency-diagram.js";
import DependencyTree from "../../run/dependency/dependency-tree.js";
import AbstractDependencyCommand from "./AbstractDependencyCommand.js";
import { DependencyObjectType } from "../../model/DependencyGraph.js";

/**
 * Command to generate dependency diagrams or trees for specified service.
 * This command allows users to visualize the dependencies of services
 * in a CHS Dev project, either as a diagram or a tree structure.
 * * @extends AbstractDependencyCommand
 * @example
 * chs-dev dependency service --type diagram service1
 * chs-dev dependency service --type tree service1
 * chs-dev dependency service --type flattree service1
 */
export default class Service extends AbstractDependencyCommand {
    static description: string = "Generates a dependency diagram / tree for the specified service";

    static args = {
        service: Args.string({
            name: "service",
            required: true,
            description: "names of service to be graphed"
        })
    };

    static flags = {
        type: Flags.string({
            char: "t",
            aliases: ["type"],
            options: ["diagram", "tree", "flattree"],
            summary: "diagram / tree / flattree",
            required: true
        })
    };

    private diagram: DependencyDiagram;
    private tree: DependencyTree;

    constructor (argv: string[], config: Config) {
        super(argv, config, DependencyObjectType.SERVICE);
        this.validArgumentHandler = this.handleValidService;

        this.diagram = new DependencyDiagram(this.dependencyObjectType, this.logger, this.getServiceByName.bind(this));
        this.tree = new DependencyTree(this.logger, this.getServiceByName.bind(this));

    }

    protected override parseArgumentsAndFlags (): Promise<{
        argv: unknown[],
        flags: Record<string, any>
    }> {
        return this.parse(Service);
    }

    /**
     * Handles the processing of a valid service name based on the provided flag values.
     *
     * Depending on the `type` flag, this method will:
     * - Generate a tree view of the service dependencies (`tree`)
     * - Generate a flattened tree view of the service dependencies (`flattree`)
     * - Create dependency diagrams for the service (`diagram`)
     * If an invalid type is provided, an error message is displayed.
     *
     * @param serviceName - The name of the service to process.
     * @returns A promise that resolves when the operation is complete.
     */
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
