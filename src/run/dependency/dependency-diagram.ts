import { writeFileSync } from "fs";
import AbstractDependencyGraph, { Logger, ServiceFinder, ServiceGitDescriptionAndOwner } from "./AbstractDependencyGraph.js";
import DependencyNode from "../../model/DependencyNode.js";
import { graphviz } from "node-graphviz";
import open from "open";
import Service from "../../model/Service.js";
import { Inventory } from "../../state/inventory.js";

type TraveseType = "service" | "system"

export default class DependencyDiagram extends AbstractDependencyGraph {

    private logger: Logger;

    constructor (logger: Logger, serviceFinder?: ServiceFinder) {
        super(serviceFinder);
        this.logger = logger;
    }

    private generateDotHeader (diagramName: string, options: { rankdir?: string, ranksep?: number, splines?: string, nodesep?: number, fontsize?: number, height?: number, width?: number } = {}): string {
        let dot = `digraph ${diagramName} {\n`;
        dot += `graph [rankdir=${options.rankdir ?? "TB"}${options.splines ? `, splines=${options.splines}` : ""}${options.nodesep ? `, nodesep=${options.nodesep}` : ""}${options.ranksep ? `, ranksep=${options.ranksep}` : ""}]\n`;
        dot += `node [shape=box, style=filled, color=lightblue2${options.fontsize ? `, fontsize=${options.fontsize}` : ""}${options.height ? `, height=${options.height}` : ""}${options.width ? `, width=${options.width}` : ""}]\n`;
        return dot;
    }

    private async generateAndOpenDiagram (dot: string, diagramPath: string, layout: "dot" | "fdp" = "dot") {
        try {
            const svg = layout === "dot"
                ? await graphviz.dot(dot, "svg")
                : await graphviz.fdp(dot, "svg");
            writeFileSync(diagramPath, svg);
            open(diagramPath);
        } catch (error) {
            this.logger(`An error occurred: ${error}`);
        }
    }

    createDependencyDiagrams (serviceOrServiceName: string | Service): void {
        const service = typeof serviceOrServiceName === "string"
            ? this.serviceFinder(serviceOrServiceName)
            : serviceOrServiceName as Service;

        if (service !== undefined) {
            const serviceName = service.name;
            this.logger(`Creating dependency diagram for service: ${serviceName}`);

            let dot = this.generateDotHeader("ServiceDependencyDiagram", { rankdir: "TB", ranksep: 2.5 });
            const seenEdges = new Set<string>();
            dot = this.handleTraverse(service.dependencyTree, dot, seenEdges);
            dot += "}";

            const DIAGRAM_PATH = `./local/${serviceName}-dependency_diagram.svg`;
            this.generateAndOpenDiagram(dot, DIAGRAM_PATH, "dot");
        }
    }

    createSystemDiagram (inventory: Inventory) {
        this.logger("Creating system dependency diagram");
        let dot = this.generateDotHeader("SystemDependencyDiagram", {
            rankdir: "TB",
            splines: "polyline",
            nodesep: 5,
            ranksep: 20,
            fontsize: 75,
            height: 3,
            width: 7
        });

        const seenEdges = new Set<string>();

        inventory.services.forEach(service => {
            dot = this.handleTraverse(service.dependencyTree, dot, seenEdges, "system");
        });

        dot += "}\n";
        const DIAGRAM_PATH = `./local/system-dependency_diagram.svg`;
        this.generateAndOpenDiagram(dot, DIAGRAM_PATH, "fdp");
    }

    handleTraverse (node: DependencyNode, dot: string, seenEdges: Set<string>, traveseType: TraveseType = "service"): string {
        if (!node) return dot;

        if (!seenEdges.has(`"${node.name}"`)) {
            seenEdges.add(`"${node.name}"`);
            if (traveseType === "service") {
                let nodeService = this.serviceFinder(node.name) as ServiceGitDescriptionAndOwner;
                if (nodeService) {
                    nodeService = this.getServiceGitDescriptionAndOwner(nodeService);
                    const tooltip = `Description: ${nodeService.gitDescription?.trim()}\nOwner: ${nodeService.teamOwner?.trim()}\nDependencies: ${nodeService.numberOfDependencies}\nUsed By: ${nodeService.timesUsedByOtherServices} service(s)\n`;
                    dot += `"${node.name}" [label="${node.name}", tooltip="${tooltip}", href="#"]\n`;
                }
            }
        }

        node.dependencies.forEach(childNode => {
            const edgeString = `"${node.name}" -> "${childNode.name}"`;
            if (!seenEdges.has(edgeString)) {
                seenEdges.add(edgeString);
                dot += `${edgeString}\n`;
            }
            dot = this.handleTraverse(childNode, dot, seenEdges);
        });

        return dot;
    }
}
