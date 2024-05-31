import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";

const fileName = ".chs-dev.yaml";

export interface State {
  modules: string[];
  services: string[];
  servicesWithLiveUpdate: string[];
  excludedFiles: string[];
}

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
            excludedFiles: []
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

    async includeFile (file: string): Promise<void> {
        let snapshot: State = this.snapshot;

        if (!snapshot.excludedFiles) {
            this.dumpState({ ...snapshot, excludedFiles: [] });
            snapshot = this.snapshot;
        }

        if (!snapshot.excludedFiles.includes(file)) {
            this.dumpState({ ...snapshot, excludedFiles: [...snapshot.excludedFiles, file] });
        }
    }

    excludeFile (tiltfile: string): void {
        let snapshot: State = this.snapshot;

        if (!snapshot.excludedFiles) {
            this.dumpState({ ...snapshot, excludedFiles: [] });
            snapshot = this.snapshot;
        }

        if (snapshot.excludedFiles.includes(tiltfile)) {
            this.dumpState({ ...snapshot, excludedFiles: snapshot.excludedFiles.filter(candidate => candidate !== tiltfile) });
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
