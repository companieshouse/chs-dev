import { simpleColouriser } from "../../helpers/colouriser.js";
import DependencyNode from "../../model/DependencyNode.js";
import AbstractDependencyGraph, { Logger, ServiceFinder } from "./AbstractDependencyGraph.js";

export default class DependencyTree extends AbstractDependencyGraph {

    private logger: (msg: string) => void;

    constructor (logger: Logger, serviceFinder: ServiceFinder) {
        super(serviceFinder);
        this.logger = logger;
    }

    generateTree = (serviceName : string) => {
        const service = this.serviceFinder(serviceName);
        if (service !== undefined) {
            let lines: string[] = [];
            const edges = new Set<string>();
            lines = this.handleTraverseTree(service.dependencyTree, lines, edges, "", true, 0);
            this.logger(lines.join("\n"));
        }
    };

    generateFlatTree = (serviceName : string) => {
        const service = this.serviceFinder(serviceName);
        if (service !== undefined) {
            let services = this.handleTraverseFlatTree(service.dependencyTree);
            services = Array.from(new Set(services.split("\n").filter(line => line.trim() !== "").map((line, index) => (index === 0 ? line.trim() : "\t" + line.trim())))).join("\n");
            this.logger(services);
        }
    };

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
