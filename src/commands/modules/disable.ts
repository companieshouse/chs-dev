import { Command } from "@oclif/core";
import AbstractModuleCommand from "./AbstractModuleCommand.js";

export default class Disable extends AbstractModuleCommand {
    static description = "Removes the services within the supplied modules from the state and any unnecessary dependencies";

    protected handleValidModule (moduleName: string): void {
        this.stateManager.excludeModule(moduleName);

        this.log(`Module "${moduleName}" is disabled`);
    }
}
