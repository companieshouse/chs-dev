import { Inventory } from "../state/inventory.js";
import DependencyNode from "../model/DependencyNode.js";
import { graphviz } from "node-graphviz";
import fs from "fs";
import open from "open";

/**
 * Creates a dependency Diagram for the services provided.
 * @returns The location of the produced file
 */
export default class SystemDependencyDiagram {

    private inventory: Inventory;

    constructor (inventory: Inventory) {
        this.inventory = inventory;
    }

    createSystemDiagram () {

        let dot = "digraph SystemDependencyDiagram {\n";
        dot += "graph [rankdir=TB, splines=polyline, nodesep=5, ranksep=20]\n";
        dot += "node [ shape=box, style=filled, color=lightblue2, fontsize=75, height=3, width=7]\n";

        const seenEdges = new Set();

        const traverse = (node : DependencyNode) => {

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
        };

        this.inventory.services.forEach(service => {
            traverse(service.dependencyTree);
        });

        dot += "}\n";
        const DIAGRAM_PATH = `./local/system-dependency_diagram.svg`;

        graphviz.fdp(dot, "svg").then((svg) => {
            try {
                fs.writeFileSync(DIAGRAM_PATH, svg);

            } catch (error) {
                console.log(`an error occurred: ${error}`);
            }
        });

        open(DIAGRAM_PATH);

    }
}
