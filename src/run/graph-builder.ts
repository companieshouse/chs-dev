export type Layout = "dot" | "fdp";

export type GraphOptions =
    | { layout: "dot"; rankdir: string; ranksep: number }
    | {
          layout: "fdp";
          rankdir: string;
          splines: string;
          nodesep: number;
          ranksep: number;
          fontsize: number;
          height: number;
          width: number;
      };

/**
 * GraphBuilder is responsible for constructing a DOT or FDP graph representation.
 * It allows adding nodes and edges with various attributes and generates the final DOT or FDP  source.
 */
export class GraphBuilder {
    private diagramName: string;
    private options: GraphOptions;
    private lines: string[] = [];

    /**
     * Initializes a new GraphBuilder instance.
     * @param diagramName - Name of the diagram
     * @param options - Graph options including layout type and attributes
     */
    constructor (diagramName: string, options: GraphOptions) {
        this.diagramName = diagramName;
        this.options = options;
        this.lines.push(`digraph ${diagramName} {`);
        this.addGraphAttributes();
        this.addNodeAttributes();
    }

    // Adds graph-level attributes based on layout type
    private addGraphAttributes () {
        if (this.options.layout === "dot") {
            const { rankdir, ranksep } = this.options;
            const attrs = `graph [rankdir=${rankdir}, ranksep=${ranksep}]`;
            this.lines.push(attrs);
        } else {
            const { rankdir, splines, nodesep, ranksep } = this.options;
            const attrs = `graph [rankdir=${rankdir}, splines=${splines}, nodesep=${nodesep}, ranksep=${ranksep}]`;
            this.lines.push(attrs);
        }
    }

    // Adds node-level attributes based on layout type
    private addNodeAttributes () {
        if (this.options.layout === "dot") {
            this.lines.push(`node [shape=box, style=filled, color=lightblue2]`);
        } else {
            const { fontsize, height, width } = this.options;
            const attrs = `node [shape=box, style=filled, color=lightblue2, fontsize=${fontsize}, height=${height}, width=${width}]`;
            this.lines.push(attrs);
        }
    }

    // Adds a node to the graph with optional label, tooltip, and hyperlink
    addNode (name: string, label?: string, tooltip?: string, href?: string) {
        let nodeStr = `"${name}"`;
        const attrs: string[] = [];
        if (label) attrs.push(`label="${label}"`);
        if (tooltip) attrs.push(`tooltip="${tooltip}"`);
        if (href) attrs.push(`href="${href}", target="_blank"`);
        if (attrs.length) nodeStr += ` [${attrs.join(", ")}]`;
        this.lines.push(nodeStr);
    }

    // Adds a directed edge between two nodes
    addEdge (from: string, to: string) {
        this.lines.push(`"${from}" -> "${to}"`);
    }

    // Builds and returns the DOT graph as a string
    build (): string {
        return this.lines.join("\n") + "\n}";
    }
}
