import { expect, jest } from "@jest/globals";
import { GraphBuilder } from "../../src/run/graph-builder.js";

describe("GraphBuilder", () => {

    let graphBuilder: GraphBuilder;

    beforeEach(() => {
        jest.resetAllMocks();
        graphBuilder = new GraphBuilder("TestDiagram", {
            layout: "dot", rankdir: "TB", ranksep: 5
        });
    });
    it("initializes with diagram name and options", () => {
        expect((graphBuilder as any).diagramName).toBe("TestDiagram");
        expect((graphBuilder as any).options.layout).toBe("dot");
        expect((graphBuilder as any).options.rankdir).toBe("TB");
    });

    it("adds nodes with label and tooltip", () => {
        graphBuilder.addNode("A", "LabelA", "TooltipA", "#ff0000");
        expect((graphBuilder as any).lines).toEqual(expect.arrayContaining([expect.stringContaining("A")]));
        expect((graphBuilder as any).lines).toEqual(expect.arrayContaining([
            expect.stringContaining("label=\"LabelA\""),
            expect.stringContaining("tooltip=\"TooltipA\""),
            expect.stringContaining("href=\"#ff0000\"")
        ]));
    });

    it("adds edges between nodes", () => {
        graphBuilder.addEdge("A", "B");
        const edgeLine = (graphBuilder as any).lines.find(line => line.includes("->"));
        expect(edgeLine).toEqual(expect.stringContaining("A"));
        expect(edgeLine).toEqual(expect.stringContaining("B"));
    });

    it("builds DOT output with nodes and edges", () => {
        graphBuilder.addNode("A", "LabelA", "TooltipA", "#ff0000");
        graphBuilder.addEdge("A", "B");
        const dot = graphBuilder.build();
        expect(dot).toEqual(expect.stringContaining("digraph TestDiagram {"));
        expect(dot).toEqual(expect.stringContaining("graph [rankdir=TB, ranksep=5]"));
        expect(dot).toEqual(expect.stringContaining("node [shape=box, style=filled, color=lightblue2]"));
        expect(dot).toEqual(expect.stringContaining("\"A\" [label=\"LabelA\", tooltip=\"TooltipA\", href=\"#ff0000\"]"));
        expect(dot).toEqual(expect.stringContaining("\"A\" -> \"B\""));
    });

    it("handles empty graph with no nodes or edges", () => {
        const dot = graphBuilder.build();
        expect(dot).toEqual(expect.stringContaining("digraph TestDiagram {"));
        expect(dot).toEqual(expect.stringContaining("graph [rankdir=TB, ranksep=5]"));
        expect(dot).toEqual(expect.stringContaining("node [shape=box, style=filled, color=lightblue2]"));
    });
});
