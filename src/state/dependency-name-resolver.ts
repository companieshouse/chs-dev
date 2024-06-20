import { deduplicate } from "../helpers/array-reducers.js";
import Service from "../model/Service.js";

/**
 * Will resolve a Service's full list of dependencies including any transitive
 * dependencies
 */
export class DependencyNameResolver {

    private readonly allServices: Partial<Service>[];

    constructor (allServices: Partial<Service>[]) {
        this.allServices = allServices;
    }

    /**
     * Resolves the list of directDependencies including any transitive
     * dependencies (i.e. all dependencies for the supplied services
     * required to run) for the list supplied.
     * @param directDependencies list of direct dependencies
     * @returns complete list of dependencies given direct dependencies
     */
    fullDependencyListIncludingTransitive (directDependencies: string[]): string[] {
        return directDependencies
            .flatMap(directDependency => [
                directDependency,
                ...this.transitiveDependencies(directDependency)
            ]).reduce(deduplicate, []);
    }

    private transitiveDependencies (dependencyName: string): string[] {
        const dependentService = this.allServices.find(service => service.name === dependencyName);

        if (!dependentService) {
            return [];
        }

        return (dependentService.dependsOn as string[])
            // recursively traverse the dependency tree
            .flatMap(dependency => [dependency, ...this.transitiveDependencies(dependency)]);
    }
}
