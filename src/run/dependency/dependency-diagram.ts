import { writeFileSync } from "fs";
import AbstractDependencyGraph, { Logger, ServiceFinder, ServiceGitDescriptionAndOwner } from "./AbstractDependencyGraph.js";

import { graphviz } from "node-graphviz";
import open from "open";
import Service from "../../model/Service.js";
import { Inventory } from "../../state/inventory.js";
import { GraphBuilder, GraphOptions } from "../graph-builder.js";
import { DependencyNode, DependencyObjectType } from "../../model/DependencyGraph.js";

/**
 * DependencyDiagram generates visual diagrams of service or system dependencies.
 */
export default class DependencyDiagram extends AbstractDependencyGraph {

    private readonly builder: GraphBuilder;
    private readonly dependencyObjectType:DependencyObjectType;
    private readonly logger: Logger;

    /**
     * Constructs a DependencyDiagram instance.
     * @param dependencyObjectType - Type of diagram ("service" or "system")
     * @param logger - Logging function
     * @param serviceFinder - Optional service lookup function
     */
    constructor (
        dependencyObjectType:DependencyObjectType,
        logger: Logger,
        serviceFinder?: ServiceFinder
    ) {
        super(serviceFinder);
        this.logger = logger;
        this.dependencyObjectType = dependencyObjectType;
        this.builder = this.createGraphBuilder();
    }

    /**
     * Creates a dependency diagram for a specific service.
     * @param serviceOrServiceName - Service object or service name string
     */
    createDependencyDiagrams (serviceOrServiceName: string | Service): void {
        const service = typeof serviceOrServiceName === "string"
            ? this.serviceFinder(serviceOrServiceName)
            : serviceOrServiceName as Service;

        if (service !== undefined) {
            const serviceName = service.name;
            this.logger(`Creating dependency diagram for service: ${serviceName}`);
            const seenEdges = new Set<string>();
            this.handleTraverse(service.dependencyTree as DependencyNode, this.builder, seenEdges);
            const dot = this.builder.build();

            const DIAGRAM_PATH = `./local/${serviceName}-dependency_diagram.svg`;
            this.generateAndOpenDiagram(dot, DIAGRAM_PATH, "dot");
        }
    }

    /**
     * Creates a system-wide dependency diagram for all services in the inventory.
     * @param inventory - Inventory containing all services
     */
    createSystemDiagram (inventory: Inventory) {
        this.logger("Creating system dependency diagram");
        const seenEdges = new Set<string>();
        inventory.services.forEach(service => {
            this.handleTraverse(service.dependencyTree as DependencyNode, this.builder, seenEdges);
        });

        const fdp = this.builder.build();
        const DIAGRAM_PATH = `./local/system-dependency_diagram.svg`;
        this.generateAndOpenDiagram(fdp, DIAGRAM_PATH, "fdp");
    }

    /**
     * Traverses the dependency tree and adds nodes/edges to the graph builder.
     * @param node - Current dependency node
     * @param builder - GraphBuilder instance
     * @param seenEdges - Set to track visited nodes/edges
     */
    handleTraverse (node: DependencyNode, builder: GraphBuilder, seenEdges: Set<string>): void {
        if (!node) return;

        if (!seenEdges.has(`"${node.name}"`)) {
            seenEdges.add(`"${node.name}"`);
            if (this.dependencyObjectType === DependencyObjectType.SERVICE) {
                let nodeService = this.serviceFinder(node.name) as ServiceGitDescriptionAndOwner;
                if (nodeService) {
                    nodeService = this.getServiceGitDescriptionAndOwner(nodeService);
                    const tooltip = `Name: ${nodeService.name.trim().toUpperCase()}\nDescription: ${nodeService.gitDescription?.trim()}\nOwner: ${nodeService.teamOwner?.trim()}\nDependencies: ${nodeService.numberOfDependencies}\nUsed By: ${nodeService.timesUsedByOtherServices} service(s)\n`;
                    builder.addNode(node.name, node.name, tooltip, "#");
                }
            }
        }

        node.dependencies.forEach(childNode => {
            const edgeString = `"${node.name}" -> "${childNode.name}"`;
            if (!seenEdges.has(edgeString)) {
                seenEdges.add(edgeString);
                builder.addEdge(node.name, childNode.name);
            }
            this.handleTraverse(childNode, builder, seenEdges);
        });
    }

    /**
     * Creates a GraphBuilder instance with options based on diagram type.
     * @returns GraphBuilder instance
     */
    private createGraphBuilder (): GraphBuilder {
        const options: GraphOptions = this.dependencyObjectType === DependencyObjectType.SERVICE
            ? { layout: "dot", rankdir: "TB", ranksep: 2.5 }
            : {
                layout: "fdp",
                rankdir: "TB",
                splines: "polyline",
                nodesep: 5,
                ranksep: 20,
                fontsize: 75,
                height: 3,
                width: 7
            };
        const diagramName = this.dependencyObjectType === DependencyObjectType.SERVICE ? "ServiceDependencyDiagram" : "SystemDependencyDiagram";
        return new GraphBuilder(diagramName, options);
    }

    /**
     * Generates an SVG diagram from DOT/Graphviz lines and opens it.
     * @param lines - DOT/Graphviz source string
     * @param diagramPath - Output file path
     * @param layout - Graphviz layout engine ("dot" or "fdp")
     */
    private async generateAndOpenDiagram (lines: string, diagramPath: string, layout: "dot" | "fdp") {
        try {
            const svg = layout === "dot"
                ? await graphviz.dot(lines, "svg")
                : await graphviz.fdp(lines, "svg");
            writeFileSync(diagramPath, svg);
            open(diagramPath);
        } catch (error) {
            this.logger(`An error occurred: ${error}`);
        }
    }

}
