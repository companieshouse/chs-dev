import { Inventory } from "../../state/inventory.js";
import { Service } from "../../model/Service.js";
import DependencyNode from "../../model/DependencyNode.js";
import { getRepoDescription } from "../../information/service/RepositoryDescription.js";
import { getTeamCodeOwner } from "../../information/service/TeamCodeOwner.js";
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

    async createDependencyDiagrams (serviceName : string) {

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

            const repoUrl = service.repository?.url?.trim() ?? null;
            let repoId: string | null = null;

            if (repoUrl && repoUrl.includes("github.com")) {
                const cleanedUrl = repoUrl.replace(/\.git$/, "").replace(/\/+$/, "");
                const match = cleanedUrl.match(/github\.com[:\/]([^\/]+\/[^\/]+)$/);
                if (match) {
                    repoId = match[1];
                }
            }

            let repoDescription = "No GitHub repo found.";
            if (repoId) {
                repoDescription = await getRepoDescription(repoId);
            }

            let teamCodeOwner  = "Unknown Code Owner.";
            if (repoId) {
                teamCodeOwner = await getTeamCodeOwner(repoId);
            }


        let serviceDetail = `{
            ${service.name}
            |
            Description: ${repoDescription.replace(/"/g, "'")}
            |
            Code Owner: ${teamCodeOwner.replace(/"/g, "'")}
            |
            Number of services that depend on this service: ${service.timesUsedByOtherServices}
            |
            Number of dependencies: ${service.numberOfDependencies}
        }`;

        dot += `info_box [shape=record, rankdir=TB, style=none, color=black label="${serviceDetail}"]\n`;
        dot += "}";

            const DIAGRAM_PATH = `./local/${serviceName}-dependency_diagram.svg`;

            graphviz.dot(dot, "svg").then((svg) => {
                fs.writeFileSync(DIAGRAM_PATH, svg);
            });

            open(DIAGRAM_PATH);
        }
    }
}
