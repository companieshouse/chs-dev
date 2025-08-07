import { expect } from "@jest/globals";
import { DependencyTreeBuilder } from "../../src/state/dependency-tree-builder.js";

describe("DependencyTreeBuilder", () => {
    const services = [
        { name: "A", dependsOn: ["B", "C"] },
        { name: "B", dependsOn: ["D"] },
        { name: "C", dependsOn: [] },
        { name: "D", dependsOn: [] }
    ];

    it("builds tree for direct and transitive dependencies", () => {
        const builder = new DependencyTreeBuilder(services);
        const tree = builder.dependencyTree("A");

        expect(tree).toEqual({
            name: "A",
            dependencies: [
                {
                    name: "B",
                    dependencies: [
                        { name: "D", dependencies: [] }
                    ]
                },
                {
                    name: "C",
                    dependencies: []
                }
            ]
        });
    });
    it("returns node with no dependencies if service not found", () => {
        const builder = new DependencyTreeBuilder(services);
        const tree = builder.dependencyTree("X");
        expect(tree).toEqual({ name: "X", dependencies: [] });
    });

    it("handles cyclic dependencies gracefully", () => {
        const cyclicServices = [
            { name: "A", dependsOn: ["B"] },
            { name: "B", dependsOn: ["A"] }
        ];
        const builder = new DependencyTreeBuilder(cyclicServices);
        const tree = builder.dependencyTree("A");
        expect(tree).toEqual({
            name: "A",
            dependencies: [
                {
                    name: "B",
                    dependencies: [
                        { name: "A", dependencies: [] }
                    ]
                }
            ]
        });
    });

    it("returns node with no dependencies if dependsOn is missing", () => {
        const incompleteServices = [
            { name: "A" }
        ];
        const builder = new DependencyTreeBuilder(incompleteServices);
        const tree = builder.dependencyTree("A");
        expect(tree).toEqual({ name: "A", dependencies: [] });
    });
});
