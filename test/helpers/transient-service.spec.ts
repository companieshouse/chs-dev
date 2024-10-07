import { expect } from "@jest/globals";
import { modules, services } from "../utils/data";
import { isTransientService } from "../../src/helpers/transient-service";
import Service from "../../src/model/Service";
import Module from "../../src/model/Module";
import { Inventory } from "../../src/state/inventory";

describe("isTransientService", () => {
    const inventory = {
        services: services as Service[],
        modules: modules as Module[]
    };

    it("returns false when service is enabled directly", () => {
        const state = {
            services: ["service-one"],
            modules: [],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };
        expect(isTransientService(state, inventory as Inventory)("service-one")).toBe(false);
    });

    it("returns false when service is enabled as a module", () => {
        const state = {
            services: [],
            modules: ["module-one"],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };
        expect(isTransientService(state, inventory as Inventory)("service-one")).toBe(false);
    });

    it("returns true when not enabled as service or module", () => {
        const state = {
            services: ["service-six"],
            modules: ["module-one"],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };
        expect(isTransientService(state, inventory as Inventory)("service-five")).toBe(true);
    });
});
