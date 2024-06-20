import { deduplicate } from "../helpers/array-reducers.js";
import Service from "../model/Service.js";
import State from "../model/State.js";
import { Inventory } from "../state/inventory.js";

type LoadedService = Service & {
  liveUpdate: boolean;
}

export class ServiceLoader {

    private readonly inventory: Inventory;

    constructor (inventory: Inventory) {
        this.inventory = inventory;
    }

    loadServices (state: State): LoadedService[] {
        const withLiveUpdate = (service: Service) => ({
            ...service,
            liveUpdate: state.servicesWithLiveUpdate.includes(service.name)
        });

        const loadedServices = this.inventory.services
            .filter(service => state.services.includes(service.name) || state.modules.includes(service.module))
            .map(withLiveUpdate);

        const fullDependencyList = loadedServices
            .flatMap(service => service.dependsOn)
            .reduce(deduplicate, [])
            .filter(serviceName => !loadedServices.some(service => service.name === serviceName))
            .map(serviceName => this.findService(serviceName) as Service)
            .map(withLiveUpdate);

        return [
            ...loadedServices,
            ...fullDependencyList
        ] as LoadedService[];
    }

    private findService (serviceName: string): Service | undefined {
        return this.inventory.services.find(service => service.name === serviceName);
    }

}
