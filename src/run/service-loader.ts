import { collect, deduplicate } from "../helpers/array-reducers.js";
import Service from "../model/Service.js";
import State from "../model/State.js";
import { Inventory } from "../state/inventory.js";

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
        return this.getActivatedServicesList(state)
            .reduce(collect<string, Service>(service => [service.name, ...service.dependsOn || []]), [])
            .reduce(deduplicate, [])
            .sort();
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
        return this.inventory.services
            .filter(service => state.services.includes(service.name) || state.modules.includes(service.module));
    }
}
