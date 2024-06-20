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
        const dependencyList: string[] = [];

        // Iterate through direct dependencies
        for (const directDependency of directDependencies) {
            // If already visited dependency continue
            if (dependencyList.includes(directDependency)) {
                continue;
            }

            // Add dependency to list and list its own dependencies
            dependencyList.push(directDependency);

            let transitiveDependencies = this.loadFurtherDependencies(directDependency);
            let exhaustedBranch: boolean = false;

            // Iterate through the branch visiting each transitive dependency
            while (!exhaustedBranch) {
                const branchServices: string[] = [];

                for (const transitiveDependency of transitiveDependencies) {
                    if (!dependencyList.includes(transitiveDependency)) {
                        dependencyList.push(transitiveDependency);
                        branchServices.push(transitiveDependency);
                    }
                }

                // load transitive dependencies as any dependencies of the
                // services just appended to the dependencyList (if any)
                transitiveDependencies = branchServices
                    .flatMap(service => this.loadFurtherDependencies(service))
                    // important that we ignore any transitive dependencies
                    // already visited
                    .filter(leaf => !dependencyList.includes(leaf));

                // If there are no more transitive dependencies to add then
                // have exhausted branch, therefore break and process next direct dependency
                if (transitiveDependencies.length === 0) {
                    exhaustedBranch = true;
                }
            }
        }

        return dependencyList;
    }

    private loadFurtherDependencies (dependencyName: string): string[] {
        return this.allServices.find(service => service.name === dependencyName)?.dependsOn || [];
    }
}
