import Config from "../../../model/Config.js";
import { Inventory } from "../../../state/inventory.js";
import { StateManager } from "../../../state/state-manager.js";

export type TroubleshootActionContext = {
    inventory: Inventory,
    stateManager: StateManager,
    config: Config,
}

/**
 * An action which will attempt to resolve issues which may be affecting the
 * docker environment.
 *
 * `autoTask` will resolve simple issues which may impact the environment, if
 * it requires a decision it will return false. It will return true if the
 * action either has resolved the issue or there was no issue to start with.
 *
 * `getOutputViaPrompt` will prompt the user to resolve the troubleshooting
 * issues
 */
export type TroubleshootAction = {
    /**
     * Checks whether the issue exists and attempts to resolve simple issues.
     * @param context containing objects which the action can use to assess the
     *      environment and resolve any issues
     * @returns true - issue no longer exists, false - issue was not
     * resolved/needs further input
     */
    autoTask?: (context: TroubleshootActionContext) => Promise<boolean>,

    /**
     * Prompts the user with instructions how to resolve any issues the action
     * has highlighted
     * @param context containing objects which the action can use to assess the
     *      environment and resolve any issues
     * @returns true - the user is happy that the issue has/will be resolved, false
     * the user is not happy to continue with troubleshooting and needs time to
     * resolve the issues encountered.
     */
    getOutputViaPrompt?: (context: TroubleshootActionContext) => Promise<boolean>
}
