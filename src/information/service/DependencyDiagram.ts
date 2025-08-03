import { Inventory } from "../../state/inventory.js";
import DependencyNode from "../../model/DependencyNode.js";
import { graphviz } from "node-graphviz";
import fs from "fs";
import open from "open";
import AbstractDependencyActions from "../AbstractDependencyActions.js";

// Upddate the cache independently
// when you run the DependencyDiagram, update the cache with gitrepository description and team owner only if it doesnt exist in cache but exist when you call the gh commands.
// Updating them all in cache leads to a lot of compute time

/**
 * Creates a dependency Diagram for the services provided.
 * @returns The location of the produced file
 */
export default class DependencyDiagram extends AbstractDependencyActions {

    constructor (inventory: Inventory) {
        super(inventory);
        this.traverseByDiagram = this.handleTraverse;
    }

    createDependencyDiagrams (serviceName : string) {
        const service = this.getService(serviceName);

        if (service !== undefined) {

            const serviceName = service.name;
            console.log("Creating dependency diagram for service:", serviceName);
            let dot = "digraph SystemDependencyDiagram {\n";
            dot += "graph [rankdir=TB, ranksep=2.5]\n";
            dot += "node [ shape=box, style=filled, color=lightblue2]\n";
            const seenEdges = new Set<string>();
            dot = this.traverseByDiagram(service.dependencyTree, dot, seenEdges);

            dot += "}";

            const DIAGRAM_PATH = `./local/${serviceName}-dependency_diagram.svg`;

            graphviz.dot(dot, "svg").then((svg) => {
                fs.writeFileSync(DIAGRAM_PATH, svg);
            });

            open(DIAGRAM_PATH);
        }
    }

    handleTraverse (node: DependencyNode, dot: string, seenEdges: Set<string>): string {

        if (!node) return dot;

        // Add the node declaration with tooltip (if not already seen)
        if (!seenEdges.has(`"${node.name}"_declared`)) {
            seenEdges.add(`"${node.name}"_declared`);
            let nodeService = this.getService(node.name);
            if (nodeService) {
                const serviceProperties = Object.keys(nodeService);
                if (!serviceProperties.includes("gitDescription") && !serviceProperties.includes("teamOwner")) {
                    nodeService = this.getServiceGitDescriptionAndOwner(nodeService);

                    // update cache with gitDescription and teamOwner
                    // console.log("updating cahce");
                    // this.inventory.updateService(nodeService);
                }

                const tooltip = `Description: ${nodeService.gitDescription?.trim()}\nOwner: ${nodeService.teamOwner?.trim()}\nDependencies: ${nodeService.numberOfDependencies}\nUsed By: ${nodeService.timesUsedByOtherServices} service(s)\n`;

                // Add node with tooltip
                dot += `"${node.name}" [label="${node.name}", tooltip="${tooltip}", href="#"]\n`;
            }
        }

        // Add edges and recurse
        node.dependencies.forEach(childNode => {
            const edgeString = `"${node.name}" -> "${childNode.name}"`;
            if (!seenEdges.has(edgeString)) {
                seenEdges.add(edgeString);
                dot += `${edgeString}\n`;
            }
            dot = this.traverseByDiagram(childNode, dot, seenEdges);
        });

        return dot;
    };
}
