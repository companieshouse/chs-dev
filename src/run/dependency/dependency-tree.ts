import { simpleColouriser } from "../../helpers/colouriser.js";
import { DependencyNode } from "../../model/DependencyGraph.js";
import AbstractDependencyGraph, { Logger, ServiceFinder } from "./AbstractDependencyGraph.js";

/**
 * DependencyTree extends AbstractDependencyGraph to provide
 * methods for generating and displaying dependency trees.
 */
export default class DependencyTree extends AbstractDependencyGraph {

    private logger: (msg: string) => void;

    /**
     * Constructs a DependencyTree with a logger and service finder.
     * @param logger - Function to log output.
     * @param serviceFinder - Function to find services by name.
     */
    constructor (logger: Logger, serviceFinder: ServiceFinder) {
        super(serviceFinder);
        this.logger = logger;
    }

    /**
     * Generates and logs a formatted dependency tree for a given service.
     * @param serviceName - Name of the service to generate the tree for.
     */
    generateTree = (serviceName : string) => {
        const service = this.serviceFinder(serviceName);
        if (service !== undefined) {
            let lines: string[] = [];
            const edges = new Set<string>();
            lines = this.handleTraverseTree(service.dependencyTree as DependencyNode, lines, edges, "", true, 0);
            this.logger(lines.join("\n"));
        }
    };

    /**
     * Generates and logs a flat list of all dependencies for a given service.
     * @param serviceName - Name of the service to generate the flat tree for.
     */
    generateFlatTree = (serviceName : string) => {
        const service = this.serviceFinder(serviceName);
        if (service !== undefined) {
            let services = this.handleTraverseFlatTree(service.dependencyTree as DependencyNode);
            services = Array.from(new Set(services.split("\n").filter(line => line.trim() !== "").map((line, index) => (index === 0 ? line.trim() : "\t" + line.trim())))).join("\n");
            this.logger(services);
        }
    };

    /**
     * Recursively traverses the dependency tree and builds a formatted tree structure.
     * @param node - Current dependency node.
     * @param lines - Accumulated lines of the tree.
     * @param edges - Set of visited node names to detect duplicates.
     * @param prefix - Prefix for formatting tree branches.
     * @param isLast - Whether the node is the last child.
     * @param depth - Current depth in the tree.
     * @returns Array of formatted tree lines.
     */
    handleTraverseTree (
        node: DependencyNode,
        lines: string[],
        edges: Set<string>,
        prefix: string,
        isLast: boolean,
        depth: number = 0
    ): string[] {

        if (!node) return lines;

        const branch = isLast ? "└── " : "├── ";
        const linePrefix = prefix + branch;

        const isDuplicate = edges.has(node.name);

        let coloredName: string;
        if (isDuplicate && depth > 1) {
            coloredName = simpleColouriser(`${node.name} (shared dependency)`, "gray");
        } else if (depth === 0) {
            coloredName = simpleColouriser(node.name, "red"); // root
        } else if (depth === 1) {
            coloredName = simpleColouriser(node.name, "yellow"); // direct dependency
        } else {
            coloredName = simpleColouriser(node.name, "green"); // subdependency
        }

        lines.push(linePrefix + coloredName);

        if (isDuplicate) return lines;

        edges.add(node.name);

        const deps = node.dependencies || [];
        const newPrefix = prefix + (isLast ? "    " : "│   ");

        deps.forEach((child, index) => {
            lines = this.handleTraverseTree(child, lines, edges, newPrefix, index === deps.length - 1, depth + 1);
        });
        return lines;
    }

    /**
     * Recursively traverses the dependency tree and builds a flat list of all dependencies.
     * @param dependencyTree - Root dependency node.
     * @returns String containing all dependencies in a flat format.
     */
    handleTraverseFlatTree (dependencyTree: DependencyNode) {
        let output = "";
        const space = "";
        function traverse (node : DependencyNode, space : string) {
            if (!node) {
                return;
            }

            let line = space;
            line += node.name;
            output += line + "\n";
            space += "    ";
            node.dependencies.forEach(childNode => traverse(childNode, space));
        }
        traverse(dependencyTree, space);
        return output;
    }
}
