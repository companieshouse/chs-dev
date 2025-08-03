import { simpleColouriser } from "../helpers/colouriser.js";
import { getRepositoryDescription, getRespositoryOwner } from "../helpers/github.js";
import DependencyNode from "../model/DependencyNode.js";
import { Service } from "../model/Service.js";
import { Inventory } from "../state/inventory.js";

type TraverseDiagram = (node: DependencyNode, dot: string, edges: Set<string>) => string;
type TraverseTree = (node: DependencyNode, output: string[], edges: Set<string>, prefix: string, isLast: boolean, depth: number
) => string[];

const defaultTraverseDiagramAction = (node: DependencyNode, dot: string, edges: Set<string> | string) => dot;
const defaultTraverseTreeAction = (node: DependencyNode, output: string[], edges: Set<string>, prefix: string, isLast: boolean, depth: number) => output;

export default abstract class AbstractDependencyActions {

    protected readonly inventory: Inventory;
    protected traverseByDiagram: TraverseDiagram = defaultTraverseDiagramAction;
    protected traverseByTree: TraverseTree = defaultTraverseTreeAction;

    constructor (inventory: Inventory) {
        this.inventory = inventory;
    }

    getService (serviceName): Service | undefined {
        return this.inventory.services.find(item => item.name === serviceName);
    }

    getServiceGitDescriptionAndOwner (service: Service): Service {
        const repoUrl = service.repository?.url;
        let gitDescription;
        let teamOwner;

        if (repoUrl) {
            const MuteError = true;
            const gitServiceName = repoUrl.replace(/\.git$/, "").split("/").pop() as string;
            gitDescription = service.module !== "infrastructure" && service.module !== "open-telemetry" ? getRepositoryDescription(gitServiceName, MuteError) : "infrastructure service";
            teamOwner = service.module !== "infrastructure" && service.module !== "open-telemetry" ? getRespositoryOwner(gitServiceName, MuteError) : "infrastructure service";
        }
        return {
            ...service,
            gitDescription: gitDescription ?? "Service Description Unavailable",
            teamOwner: teamOwner ?? "Service Owner Unavailable"
        };
    }

    // handleTraverseByDiagram (node: DependencyNode, dot: string, seenEdges: Set<string>): string {

    //     if (!node) return dot;

    //     // Add the node declaration with tooltip (if not already seen)
    //     if (!seenEdges.has(`"${node.name}"_declared`)) {
    //         seenEdges.add(`"${node.name}"_declared`);
    //         let nodeService = this.getService(node.name);
    //         if (nodeService) {
    //             const serviceProperties = Object.keys(nodeService);
    //             if (!serviceProperties.includes("gitDescription") && !serviceProperties.includes("teamOwner")) {
    //                 nodeService = this.getServiceGitDescriptionAndOwner(nodeService);

    //                 // update cache with gitDescription and teamOwner
    //                 // console.log("updating cahce");
    //                 // this.inventory.updateService(nodeService);
    //             }

    //             const tooltip = `Description: ${nodeService.gitDescription?.trim()}\nOwner: ${nodeService.teamOwner?.trim()}\nDependencies: ${nodeService.numberOfDependencies}\nUsed By: ${nodeService.timesUsedByOtherServices} service(s)\n`;

    //             // Add node with tooltip
    //             dot += `"${node.name}" [label="${node.name}", tooltip="${tooltip}", href="#"]\n`;
    //         }
    //     }

    //     // Add edges and recurse
    //     node.dependencies.forEach(childNode => {
    //         const edgeString = `"${node.name}" -> "${childNode.name}"`;
    //         if (!seenEdges.has(edgeString)) {
    //             seenEdges.add(edgeString);
    //             dot += `${edgeString}\n`;
    //         }
    //         dot = this.traverseByDiagram(childNode, dot, seenEdges);
    //     });

    //     return dot;
    // };

    // handleTraverseByTree (
    //     node: DependencyNode,
    //     lines: string[],
    //     edges: Set<string>,
    //     prefix: string,
    //     isLast: boolean,
    //     depth: number = 0
    // ): string[] {

    //     if (!node) return lines;

    //     const branch = isLast ? "└── " : "├── ";
    //     const linePrefix = prefix + branch;

    //     const isDuplicate = edges.has(node.name);

    //     let coloredName: string;
    //     if (isDuplicate && depth > 1) {
    //         coloredName = simpleColouriser(`${node.name} (shared dependency)`, "gray");
    //     } else if (depth === 0) {
    //         coloredName = simpleColouriser(node.name, "red"); // root
    //     } else if (depth === 1) {
    //         coloredName = simpleColouriser(node.name, "yellow"); // direct dependency
    //     } else {
    //         coloredName = simpleColouriser(node.name, "green"); // subdependency
    //     }

    //     lines.push(linePrefix + coloredName);

    //     if (isDuplicate) return lines;

    //     edges.add(node.name);

    //     const deps = node.dependencies || [];
    //     const newPrefix = prefix + (isLast ? "    " : "│   ");

    //     deps.forEach((child, index) => {
    //         lines = this.traverseByTree(child, lines, edges, newPrefix, index === deps.length - 1, depth + 1);
    //     });
    //     return lines;
    // }

}
