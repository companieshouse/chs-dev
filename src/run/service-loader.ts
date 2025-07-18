import { readFileSync } from "fs";
import { collect, deduplicate } from "../helpers/array-reducers.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";
import Service from "../model/Service.js";
import State from "../model/State.js";
import { Inventory } from "../state/inventory.js";
import yaml from "yaml";

type LoadedService = Service & {
  liveUpdate: boolean;
}

/**
 * Class to load services from inventory and state
 */
export class ServiceLoader {

    private readonly inventory: Inventory;

    constructor (inventory: Inventory) {
        this.inventory = inventory;
    }

    /**
     * Loads the exhaustive list of services to run based upon inventory and
     * state
     * @param state of the environment
     * @returns list of loaded services to be run
     */
    loadServices (state: State): LoadedService[] {
        /**
         * Appends the field liveUpdate to service to make a LoadedService
         * @param service missing liveUpdate
         * @returns LoadedService including liveUpdate and attributes of Service
         */
        const withLiveUpdate = (service: Service) => ({
            ...service,
            liveUpdate: state.servicesWithLiveUpdate.includes(service.name)
        });

        // Collect all services specifed by the state to include
        const loadedServices = this.getActivatedServicesList(state)
            // TODO: Remove after dual running period - RAND-397
            .filter(service => !this.serviceIsDeprecated(service))
            .map(withLiveUpdate);

        // Collect all dependent services ensuring there are no duplicates
        const fullDependencyList = loadedServices
            .flatMap(service => service.dependsOn)
            .reduce(deduplicate, [])
            .filter(serviceName => !loadedServices.some(service => service.name === serviceName))
            .map(serviceName => this.findService(serviceName))
            .filter(service => {
                return typeof service !== "undefined";
            })
            // wont be undefined as filtered out above
            // @ts-expect-error
            .map(withLiveUpdate);

        return [
            ...loadedServices,
            ...fullDependencyList
        ] as LoadedService[];
    }

    /**
     * Loads sorted and unique list of activated serviceNames from inventory.
     * @param state of the environment
     * @returns list of manually and automatically activated services names.
     */
    loadServicesNames (state: State): string[] {
        const activated = this.getActivatedServicesList(state);
        const names = new Set<string>();

        for (const service of activated) {
            names.add(service.name);
            if (service.dependsOn) {
                for (const dep of service.dependsOn) {
                    names.add(dep);
                }
            }
        }

        return Array.from(names).sort();
    }

    /**
     * Retrieves the direct dependencies of a given service as defined in its Docker Compose specification.
     *
     * This method locates the service by name, reads its Docker Compose YAML file,
     * and extracts the `depends_on` field for the specified service.
     * If the service or its source file is not found, an empty array is returned.
     *
     * @param serviceName - The name of the service whose direct dependencies are to be retrieved.
     * @returns An array of service names that the specified service directly depends on.
     */
    getServiceDirectDependencies (serviceName: string): string[] {
        const service = this.findService(serviceName);

        if (!service?.source) return [];
        const dockerCompose: DockerComposeSpec = yaml.parse(
            readFileSync(service.source, "utf-8")
        );
        const dependsOn = dockerCompose.services?.[serviceName]?.depends_on || [];
        return Array.isArray(dependsOn) ? dependsOn : Object.keys(dependsOn);
    }

    private findService (serviceName: string): Service | undefined {
        return this.inventory.services.find(service => service.name === serviceName && !this.serviceIsDeprecated(service));
    }

    private serviceIsDeprecated (service: Service): boolean {
        return Object.keys(service.metadata).includes("deprecated") &&
            service.metadata.deprecated?.toLowerCase() === "true";
    }

    /**
     * Filters the inventory(all services) by state object(activated service/module names)
     * @param state of the environment
     * @returns list of activated services as Service object
     */
    private getActivatedServicesList (state: State): Service[] {
        const serviceNames = new Set(state.services);
        const moduleNames = new Set(state.modules);
        return this.inventory.services.filter(
            service => serviceNames.has(service.name) || moduleNames.has(service.module)
        );
    }
}
