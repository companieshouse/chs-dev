import { Inventory } from "../../state/inventory.js";
import { Service } from "../../model/Service.js";
import DependencyNode from "../../model/DependencyNode.js";
import { graphviz } from "node-graphviz";
import fs from "fs";
import open from "open";

/**
 * Creates a dependency Diagram for the services provided.
 * @returns The location of the produced file
 */
export default class DependencyDiagram {

    private inventory: Inventory;

    constructor (inventory: Inventory) {
        this.inventory = inventory;
    }

    createDependencyDiagrams (serviceName : string) {

        const service = this.inventory.services.find(item => item.name === serviceName) as Service;
        if (service !== undefined) {
            console.log(service);
            let dot = "digraph SystemDependencyDiagram {\n";
            dot += "graph [rankdir=TB, ranksep=2.5]";
            dot += "node [ shape=box, style=filled, color=lightblue2]";

            const seenEdges = new Set();

            function traverse (node : DependencyNode) {

                if (!node) {
                    return;
                }

                node.dependencies.forEach(childNode => {
                    const edgeString = `"${node.name}" -> "${childNode.name}"`;
                    if (!seenEdges.has(edgeString)) {
                        seenEdges.add(edgeString);
                        dot += `${edgeString}\n`;
                    }
                    traverse(childNode);
                });
            }
            traverse(service.dependencyTree);
           

            const DIAGRAM_PATH = `./local/${serviceName}-dependency_diagram.svg`;

            graphviz.dot(dot, "svg").then((svg) => {
                fs.writeFileSync(DIAGRAM_PATH, svg);
            });

            open(DIAGRAM_PATH);
        }
    }
}
