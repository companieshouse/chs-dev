import { Args, Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";
import { StateManager } from "../../state/state-manager.js";
import AbstractModuleCommand from "./AbstractModuleCommand.js";

export default class Enable extends AbstractModuleCommand {

    static description = "Enables the services within the supplied modules";

    protected handleValidModule (moduleName: string): void {
        this.stateManager.includeModule(moduleName);

        this.log(`Module "${moduleName}" is enabled`);
    }
}
