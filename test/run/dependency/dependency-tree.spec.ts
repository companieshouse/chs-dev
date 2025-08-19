import DependencyTree from "../../../src/run/dependency/dependency-tree";
import { DependencyNode } from "../../../src/model/DependencyGraph";
import { expect, jest } from "@jest/globals";
import { ServiceFinder } from "../../../src/run/dependency/AbstractDependencyGraph";
import Service from "../../../src/model/Service";

// Mocks
jest.mock("../../../src/helpers/colouriser.js", () => ({
    simpleColouriser: (str: string, _colour: string) => str
}));

// Helper to build DependencyNode
function node (name: string, dependencies: DependencyNode[] = []): DependencyNode {
    return { name, dependencies };
}

describe("DependencyTree", () => {
    let logger: jest.Mock;
    let serviceFinder: jest.Mock<ServiceFinder>;

    beforeEach(() => {
        logger = jest.fn();
        serviceFinder = jest.fn() as jest.Mock<ServiceFinder>;
    });

    it("should log a single node tree correctly with generateTree", () => {
        const serviceName = "ServiceA";
        serviceFinder.mockReturnValue({
            dependencyTree: node(serviceName)
        } as Service);
        const tree = new DependencyTree(logger, serviceFinder);
        tree.generateTree(serviceName);

        expect(logger).toHaveBeenCalledWith(expect.stringContaining("└── ServiceA"));
    });

    it("should log a multi-level tree with correct formatting", () => {
        const serviceName = "Root";
        const depTree = node(serviceName, [
            node("Dep1", [
                node("SubDep1"),
                node("SubDep2")
            ]),
            node("Dep2")
        ]);
        serviceFinder.mockReturnValue({ dependencyTree: depTree } as Service);
        const tree = new DependencyTree(logger, serviceFinder);
        tree.generateTree(serviceName);

        const output = logger.mock.calls[0][0];
        expect(output).toContain("└── Root");
        expect(output).toContain("├── Dep1");
        expect(output).toContain("│   ├── SubDep1");
        expect(output).toContain("│   └── SubDep2");
        expect(output).toContain("└── Dep2");
    });

    it("should mark shared dependencies as (shared dependency)", () => {
        const serviceName = "Root";
        const shared = node("Shared");
        const depTree = node(serviceName, [
            node("Dep1", [shared]),
            node("Dep2", [shared])
        ]);
        serviceFinder.mockReturnValue({ dependencyTree: depTree }as Service);
        const tree = new DependencyTree(logger, serviceFinder);
        tree.generateTree(serviceName);

        const output = logger.mock.calls[0][0];
        expect(output).toContain("Shared (shared dependency)");
    });

    it("should log a flat tree for a single node", () => {
        const serviceName = "Solo";
        serviceFinder.mockReturnValue({ dependencyTree: node(serviceName) } as Service);
        const tree = new DependencyTree(logger, serviceFinder);
        tree.generateFlatTree(serviceName);

        expect(logger).toHaveBeenCalledWith("Solo");
    });

    it("should log a flat tree for multi-level tree with deduplication", () => {
        const serviceName = "Root";
        const shared = node("Shared");
        const depTree = node(serviceName, [
            node("Dep1", [shared]),
            node("Dep2", [shared])
        ]);
        serviceFinder.mockReturnValue({ dependencyTree: depTree } as Service);
        const tree = new DependencyTree(logger, serviceFinder);
        tree.generateFlatTree(serviceName);

        const output:any = logger.mock.calls[0][0];
        // Should contain all nodes, but only one "Shared"
        expect(output).toContain("Root");
        expect(output).toContain("Dep1");
        expect(output).toContain("Dep2");
        expect(output.match(/Shared/g)?.length).toBe(1);
    });

    it("should not log if service is not found", () => {
        serviceFinder.mockReturnValue(undefined);
        const tree = new DependencyTree(logger, serviceFinder);
        tree.generateTree("UnknownService");
        tree.generateFlatTree("UnknownService");
        expect(logger).not.toHaveBeenCalled();
    });

    it("should handle empty dependency tree gracefully", () => {
        serviceFinder.mockReturnValue({ dependencyTree: undefined } as Service);
        const tree = new DependencyTree(logger, serviceFinder);
        tree.generateTree("EmptyService");
        tree.generateFlatTree("EmptyService");
        // Should log nothing or empty string
        expect(logger).toHaveBeenCalledWith("");
        expect(logger).toHaveBeenCalledWith("");
    });
});
