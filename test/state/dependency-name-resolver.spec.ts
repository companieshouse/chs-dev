import { expect } from "@jest/globals";
import { DependencyNameResolver } from "../../src/state/dependency-name-resolver";

const services = [
    {
        name: "service-one",
        dependsOn: []
    },
    {
        name: "service-two",
        dependsOn: [
            "service-one"
        ]
    },
    {
        name: "service-three",
        dependsOn: ["service-two"]
    },
    {
        name: "service-four",
        dependsOn: ["service-three"]
    },
    {
        name: "service-five",
        dependsOn: []
    },
    {
        name: "service-six",
        dependsOn: ["service-five", "service-three"]
    },
    {
        name: "service-seven",
        dependsOn: ["service-six", "service-four"]
    }
];
const dependencyNameResolver = new DependencyNameResolver(services);

describe("DependencyNameResolver", () => {

    it("returns only direct when there are no transitive", () => {
        const result = dependencyNameResolver.fullDependencyListIncludingTransitive(["service-five"]);

        expect(result).toEqual([
            "service-five"
        ]);
    });

    it("returns direct and the dependencies of the child", () => {
        const result = dependencyNameResolver.fullDependencyListIncludingTransitive(["service-two"]);

        expect(result).toEqual([
            "service-two",
            "service-one"
        ]);
    });

    it("returns all transitive dependencies", () => {
        const result = dependencyNameResolver.fullDependencyListIncludingTransitive(["service-four"]);

        expect(result).toHaveLength(4);
        expect(result).toContainEqual("service-one");
        expect(result).toContainEqual("service-two");
        expect(result).toContainEqual("service-three");
        expect(result).toContainEqual("service-four");
    });

    it("returns deduplicated transitive dependencies", () => {
        const result = dependencyNameResolver.fullDependencyListIncludingTransitive(["service-seven", "service-four"]);

        expect(result).toHaveLength(7);
        expect(result).toContainEqual("service-one");
        expect(result).toContainEqual("service-two");
        expect(result).toContainEqual("service-three");
        expect(result).toContainEqual("service-four");
        expect(result).toContainEqual("service-five");
        expect(result).toContainEqual("service-six");
        expect(result).toContainEqual("service-seven");
    });
});
