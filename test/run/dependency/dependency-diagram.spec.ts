import { expect, jest } from "@jest/globals";
import { DependencyNode, DependencyObjectType } from "../../../src/model/DependencyGraph.js";
import DependencyDiagram from "../../../src/run/dependency/dependency-diagram.js";
import { GraphBuilder, GraphOptions } from "../../../src/run/graph-builder.js";

import Service from "../../../src/model/Service.js";
import { Inventory } from "../../../src/state/inventory.js";
import { ServiceFinder } from "../../../src/run/dependency/AbstractDependencyGraph.js";
import fs from "fs";
import { graphviz } from "node-graphviz";
import { modules, services } from "../../utils/data.js";

type ServiceGitDescriptionAndOwner = Service & {
    gitDescription: string;
    teamOwner: string;
};

jest.mock("node-graphviz");
jest.mock("../../../src/state/inventory.js");
jest.mock("open", () => jest.fn());

const mockService = (name: string, dependencies: DependencyNode[] = []) => ({
    name,
    dependencyTree: { name, dependencies },
    gitDescription: "desc",
    teamOwner: "owner",
    numberOfDependencies: dependencies.length,
    timesUsedByOtherServices: 1
});

const inventoryMock = {
    services,
    modules
} as Inventory;

// Helper to build DependencyNode
function node (name: string, dependencies: DependencyNode[] = []): DependencyNode {
    return { name, dependencies };
}

describe("DependencyDiagram", () => {
    let diagram: DependencyDiagram;
    const mockLogger = jest.fn();
    const mockServiceFinder = jest.fn() as jest.Mock<ServiceFinder>;
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        mockServiceFinder.mockReturnValue(
            mockService("A", [node("B")]) as ServiceGitDescriptionAndOwner
        );
        diagram = new DependencyDiagram(DependencyObjectType.SERVICE, mockLogger, mockServiceFinder);
        writeFileSyncSpy.mockReturnValue(undefined);
    });

    it("logs and generates diagram for a service", async () => {

        (graphviz.dot as jest.Mock).mockImplementation(() => Promise.resolve("<svg>dot</svg>"));

        await diagram.createDependencyDiagrams("A");

        expect(mockLogger).toHaveBeenCalledWith(expect.stringContaining("Creating dependency diagram for service: A"));
        expect(writeFileSyncSpy).toHaveBeenCalledWith(
            expect.stringContaining("A-dependency_diagram.svg"),
            "<svg>dot</svg>"
        );
        expect(require("open")).toHaveBeenCalled();
    });

    it("does not log or generate diagram if service not found", async () => {
        mockServiceFinder.mockReturnValue(undefined);
        const diagram = new DependencyDiagram(DependencyObjectType.SERVICE, mockLogger, mockServiceFinder);

        await diagram.createDependencyDiagrams("Unknown");

        expect(mockLogger).not.toHaveBeenCalledWith(expect.stringContaining("Creating dependency diagram"));
        expect(writeFileSyncSpy).not.toHaveBeenCalled();
    });

    it("logs and generates system diagram from the inventory", async () => {

        (graphviz.fdp as jest.Mock).mockImplementation(() => Promise.resolve("<svg>fdp</svg>"));

        diagram = new DependencyDiagram(DependencyObjectType.SYSTEM, mockLogger);

        await diagram.createSystemDiagram(inventoryMock);

        expect(mockLogger).toHaveBeenCalledWith("Creating system dependency diagram");
        expect(writeFileSyncSpy).toHaveBeenCalledWith(
            expect.stringContaining("system-dependency_diagram.svg"),
            "<svg>fdp</svg>"
        );
        expect(require("open")).toHaveBeenCalled();
    });

    it("handleTraverse adds nodes and edges to builder", () => {
        const builder = new GraphBuilder("Test", {} as GraphOptions);
        builder.addNode = jest.fn();
        builder.addEdge = jest.fn();

        const service = mockService("A", [node("B")]) as ServiceGitDescriptionAndOwner;

        const seenEdges = new Set<string>();
        diagram.handleTraverse(service.dependencyTree as DependencyNode, builder, seenEdges);

        expect(builder.addNode).toHaveBeenCalledWith("A", "A", expect.any(String), "#");
        expect(builder.addEdge).toHaveBeenCalledWith("A", "B");
    });

    it("generateAndOpenDiagram logs error on failure", async () => {

        const error = new Error("fail");
        (graphviz.dot as jest.Mock).mockImplementation(() => Promise.reject(error));

        await (diagram as any).generateAndOpenDiagram("lines", "path.svg", "dot");

        expect(mockLogger).toHaveBeenCalledWith(expect.stringContaining("An error occurred"));
    });
});
