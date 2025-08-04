import Service from "../model/Service.js";
import DependencyTree, { DependencyNode } from "../model/DependencyNode.js";

/**
 * Will resolve a Service's full list of dependencies including any transitive
 * dependencies and create a tree structure
 */
export class DependencyTreeBuilder {

    private readonly allServices: Partial<Service>[];

    constructor (allServices: Partial<Service>[]) {
        this.allServices = allServices;
    }

    /**
     * Resolves the dependency tree for the supplied service.
     * @param serviceName ServiceName to produce a dependency tree for
     * @returns A complete dependency tree for the specified service
     */
    dependencyTree (serviceName: string, seen = new Set()): DependencyTree {

        const NO_DEPENDENCIES : DependencyNode = { name: serviceName, dependencies: [] };

        if (seen.has(serviceName)) {
            return NO_DEPENDENCIES;
        }
        seen.add(serviceName);
        const service = this.allServices.find(item => item.name === serviceName);

        if (!service || !service.dependsOn) {
            return NO_DEPENDENCIES;
        }

        const tree = {
            name: serviceName,
            dependencies: service.dependsOn.map(dependency => this.dependencyTree(dependency, new Set(seen)))
        };

        return tree;
    }
}
