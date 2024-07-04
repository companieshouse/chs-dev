import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import { State } from "../model/State.js";

const fileName = ".chs-dev.yaml";

export class StateManager {
    constructor (private path: string) {
        this.path = path;
    }

    get snapshot (): State {
        const path = join(this.path, fileName);
        if (existsSync(path)) {
            return yaml.parse(readFileSync(path).toString());
        }
        return {
            modules: [],
            services: [],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };
    }

    includeModule (moduleName: string): void {
        const snapshot: State = this.snapshot;

        if (!snapshot.modules.includes(moduleName)) {
            this.dumpState({ ...snapshot, modules: [...snapshot.modules, moduleName] });
        }
    }

    excludeModule (moduleName: string): void {
        const snapshot: State = this.snapshot;

        if (snapshot.modules.includes(moduleName)) {
            this.dumpState({ ...snapshot, modules: snapshot.modules.filter(candidate => candidate !== moduleName) });
        }
    }

    includeService (serviceName: string): void {
        const snapshot: State = this.snapshot;

        if (!snapshot.services.includes(serviceName)) {
            this.dumpState({ ...snapshot, services: [...snapshot.services, serviceName] });
        }
    }

    excludeService (serviceName: string): void {
        const snapshot: State = this.snapshot;

        if (snapshot.services.includes(serviceName)) {
            this.dumpState({ ...snapshot, services: snapshot.services.filter(candidate => candidate !== serviceName) });
        }
    }

    async addExclusionForService (service: string): Promise<void> {
        let snapshot: State = this.snapshot;

        if (!snapshot.excludedServices) {
            this.dumpState({ ...snapshot, excludedServices: [] });
            snapshot = this.snapshot;
        }

        if (!snapshot.excludedServices.includes(service)) {
            this.dumpState({ ...snapshot, excludedServices: [...snapshot.excludedServices, service] });
        }
    }

    removeExclusionForService (service: string): void {
        let snapshot: State = this.snapshot;

        if (!snapshot.excludedServices) {
            this.dumpState({ ...snapshot, excludedServices: [] });
            snapshot = this.snapshot;
        }

        if (snapshot.excludedServices.includes(service)) {
            this.dumpState({ ...snapshot, excludedServices: snapshot.excludedServices.filter(candidate => candidate !== service) });
        }
    }

    includeServiceInLiveUpdate (serviceName: string): void {
        const snapshot: State = this.snapshot;

        if (!snapshot.servicesWithLiveUpdate.includes(serviceName)) {
            this.dumpState({ ...snapshot, servicesWithLiveUpdate: [...snapshot.servicesWithLiveUpdate, serviceName] });
        }
    }

    excludeServiceFromLiveUpdate (serviceName: string): void {
        const snapshot: State = this.snapshot;

        if (snapshot.servicesWithLiveUpdate.includes(serviceName)) {
            this.dumpState({ ...snapshot, servicesWithLiveUpdate: snapshot.servicesWithLiveUpdate.filter(candidate => candidate !== serviceName) });
        }
    }

    private dumpState (state: State): void {
        const lines = [
            "# DO NOT MODIFY MANUALLY",
            yaml.stringify(state)
        ];
        writeFileSync(join(this.path, fileName), lines.join("\n\n"));
    }
}
