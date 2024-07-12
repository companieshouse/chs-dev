import { Inventory } from "../state/inventory.js";

/**
 * Validator function factory which is capable of validating service names
 * @param inventory representing the repository's available services
 * @param error function called when there is an error
 * @param requireRepository whether or not the service requires a repository
 *        to be valid
 * @returns predicate when supplied a service name (string) indicates whether
 *          the service is present within the inventory and meets the required
 *          criteria around having a repository
 */
export const serviceValidator = (inventory: Inventory, error: (message: string) => void, requireRepository: boolean = false) => (serviceName: string) => {
    if (serviceName === null || serviceName === undefined) {
        error("Service must be provided");
        return false;
    }

    const service = inventory.services.find(service => service.name === serviceName);

    if (typeof service === "undefined") {
        error(`Service "${serviceName}" is not defined in inventory`);
        return false;
    }

    if (requireRepository && (service.repository === null || typeof service.repository === "undefined")) {
        error(`Service "${serviceName}" does not have repository defined`);
        return false;
    }

    return true;
};

/**
 * Validator function factory which is capable of validating module names
 * @param inventory representing the repository's available modules
 * @param error function called when there is an error
 * @returns predicate when supplied a module name (string) indicates whether
 *          the module is present within the inventory
 */
export const moduleValidator = (inventory: Inventory, error: (message: string) => void) => (moduleName: string) => {
    if (moduleName === null || moduleName === undefined) {
        error("Module must be provided");
        return false;
    }

    const module = inventory.modules.find(module => module.name === moduleName);

    if (typeof module === "undefined" || module === null) {
        error(`Module "${moduleName}" is not defined in inventory`);
        return false;
    }

    return true;
};
