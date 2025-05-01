import { Inventory } from "../../state/inventory.js";
import { Service } from "../../model/Service.js";
import DependencyNode from "../../model/DependencyNode.js";

/**
 * Creates a dependency tree for the services provided.
 * @returns The human readable tree structure for the dependencies
 */
export default class DependencyTree {

    private inventory: Inventory;

    constructor (inventory: Inventory) {
        this.inventory = inventory;
    }

    generateTree = (serviceName : string) => {

        const service: Service | undefined = this.inventory.services.find(item => item.name === serviceName);
        if (service !== undefined) {
            console.log(this.getHumanReadableTree(service.dependencyTree));
        }
    };

    generateFlatTree = (serviceName : string) => {

        const service: Service | undefined = this.inventory.services.find(item => item.name === serviceName);
        if (service !== undefined) {
            var services = this.getHumanReadableTree(service.dependencyTree);
            services = Array.from(new Set(services.split("\n").filter(line => line.trim() !== "").map((line, index) => (index === 0 ? line.trim() : "\t" + line.trim())))).join("\n");
            console.log(services);
        }
    };

    getHumanReadableTree (dependencyTree: DependencyNode): string {
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
