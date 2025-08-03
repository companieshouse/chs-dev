import { Inventory } from "../../state/inventory.js";
import { Service } from "../../model/Service.js";
import DependencyNode from "../../model/DependencyNode.js";
import AbstractDependencyActions from "../AbstractDependencyActions.js";
import { simpleColouriser } from "../../helpers/colouriser.js";

/**
 * Creates a dependency tree for the services provided.
 * @returns The human readable tree structure for the dependencies
 */
export default class DependencyTree extends AbstractDependencyActions {

    service: Service | undefined;

    constructor (inventory: Inventory) {
        super(inventory);
        this.traverseByTree = this.handleTraverse;
    }

    generateTree = (serviceName : string) => {
        const service = this.getService(serviceName);
        if (service !== undefined) {
            let lines: string[] = [];
            const edges = new Set<string>();
            lines = this.traverseByTree(service.dependencyTree, lines, edges, "", true, 0);
            console.log(lines.join("\n"));
        }
    };

    generateFlatTree = (serviceName : string) => {
        const service = this.getService(serviceName);
        if (service !== undefined) {
            let services = this.ha(service.dependencyTree);
            services = Array.from(new Set(services.split("\n").filter(line => line.trim() !== "").map((line, index) => (index === 0 ? line.trim() : "\t" + line.trim())))).join("\n");
            console.log(services);
        }
    };

    ha (dependencyTree: DependencyNode) {
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

    getHumanReadableTree (dependencyTree: DependencyNode): string {
        let lines: string[] = [];
        const edges = new Set<string>();

        lines = this.traverseByTree(dependencyTree, lines, edges, "", true, 0);
        return lines.join("\n");
    }

    handleTraverse (
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
            lines = this.traverseByTree(child, lines, edges, newPrefix, index === deps.length - 1, depth + 1);
        });
        return lines;
    }
}
