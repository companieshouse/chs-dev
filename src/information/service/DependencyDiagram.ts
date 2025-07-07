import { Inventory } from "../../state/inventory.js";
import { Service } from "../../model/Service.js";
import DependencyNode from "../../model/DependencyNode.js";
import { graphviz } from "node-graphviz";
import fs from "fs";
import open from "open";
import * as cheerio from "cheerio";
import { HTLMSVGGenerator } from "../../generator/html-svg-generator.js";
import { getRepositoryDescription, getRespositoryOwner } from "../../helpers/github.js";
/**
 * Creates a dependency Diagram for the services provided.
 * @returns The location of the produced file
 */
export default class DependencyDiagram extends HTLMSVGGenerator {

    private inventory: Inventory;

    constructor (inventory: Inventory) {
        super();
        this.inventory = inventory;
    }

    async createDependencyDiagrams (serviceName : string) {

        const service = this.inventory.services.find(item => item.name === serviceName) as Service;
        if (service !== undefined) {
            const serviceName = service.name;
            console.log("Creating dependency diagram for service:", serviceName);

            let dot = "digraph SystemDependencyDiagram {\n";
            dot += "graph [rankdir=TB, ranksep=2.5]";
            dot += "node [ shape=box, style=filled, color=lightblue2]";
            // Add nodes explicitly with labels
            const seenNodes = new Set<string>();

            function addNodes (node: DependencyNode) {
                if (!node || seenNodes.has(node.name)) return;
                seenNodes.add(node.name);
                dot += `"${node.name}" [label="${node.name}" style=filled fillcolor=lightblue2];\n`;
                node.dependencies.forEach(addNodes);
            }

            addNodes(service.dependencyTree);

            // Add edges
            const seenEdges = new Set<string>();
            function addEdges (node: DependencyNode) {
                if (!node) return;
                node.dependencies.forEach((childNode) => {
                    const edgeString = `"${node.name}" -> "${childNode.name}"`;
                    if (!seenEdges.has(edgeString)) {
                        seenEdges.add(edgeString);
                        dot += `${edgeString};\n`;
                    }
                    addEdges(childNode);
                });
            }
            addEdges(service.dependencyTree);
            dot += "}\n";

            // dot += `info_box [shape=record, rankdir=TB, style=none, color=black label="${serviceDetail}"]\n`;
            // dot += "}";

            const DIAGRAM_PATH = `./local/${serviceName}-dependency_diagram.svg`;

            const svg = await graphviz.dot(dot, "svg");

            const $ = cheerio.load(svg, { xmlMode: true });

            const serviceDetailsMap: Record<string, string> = {};

            // We'll add dummy details for each node for now; replace with your real info fetching if needed\

            seenNodes.forEach((nodeName) => {
                if (nodeName === serviceName) {
                    serviceDetailsMap[nodeName] = `
                    Service Name: ${serviceName}\n
                    Description: ${getRepositoryDescription(serviceName)}\n
                    Service Owner: ${getRespositoryOwner(serviceName)}\n
                    Dependencies Count: ${service.numberOfDependencies}`;
                } else {
                    // For other nodes, just a placeholder text
                    serviceDetailsMap[nodeName] = `Service: ${nodeName}\n(No extra info available)`;
                }
            });

            $("g.node").each((_, elem) => {
                const titleText = $(elem).find("title").text();
                if (titleText) {
                    const id = `node-${titleText.replace(/\s+/g, "_")}`;
                    $(elem).attr("id", id);
                    // Optional: add cursor style for interactivity
                    $(elem).attr("style", "cursor:pointer");
                }
            });

            fs.writeFileSync(DIAGRAM_PATH, $.xml());

            // Generate a simple HTML file to show the SVG with interactivity
            const htmlPath = `./local/${serviceName}-dependency_diagram.html`;
            const htmlContent = this.generateHTMLContent(serviceName, serviceDetailsMap);

            fs.writeFileSync(htmlPath, htmlContent);

            // Open the HTML page in default browser to see interactivity
            // await open(htmlPath);

            // graphviz.dot(dot, "svg").then((svg) => {
            //     fs.writeFileSync(DIAGRAM_PATH, svg);
            // });

            // open(DIAGRAM_PATH);
        }
    }
}
