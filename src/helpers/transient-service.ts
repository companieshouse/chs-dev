import State from "../model/State.js";
import { Inventory } from "../state/inventory.js";

export const isTransientService = (state: State, inventory: Inventory) => (serviceName: string) => {
    return !state.services.includes(serviceName) &&
        !state.modules
            .flatMap(moduleName => inventory.services
                .filter(({ module }) => module === moduleName))
            .some(({ name }) => name === serviceName);
};
