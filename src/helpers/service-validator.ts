import { Inventory } from "../state/inventory.js";

export const serviceValidator = (inventory: Inventory, error: (message: string) => void) => (serviceName: string) => {
    if (serviceName === null || serviceName === undefined) {
        error("Service must be provided");
        return false;
    }
    if (!inventory.services.map(service => service.name).includes(serviceName)) {
        error(`Service "${serviceName}" is not defined in inventory`);
        return false;
    }
    return true;
};
