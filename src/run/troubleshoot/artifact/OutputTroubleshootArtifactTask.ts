import Config from "../../../model/Config.js";
import { Inventory } from "../../../state/inventory.js";
import { StateManager } from "../../../state/state-manager.js";
import { TroubleshootArtifactContext } from "./TroubleshootArtifactContext.js";

/**
 * Defines the options type passed to Tasks
 */
export type OutputTroubleshootArtifactTaskOptions = {
    inventory: Inventory

    stateManager: StateManager

    /**
     * Place to output artifacts to
     */
    outputDirectory: string

    /**
     * Configuration for the chs-dev service
     */
    config: Config

    /**
     * Defines the context for the Troubleshooting which can be appended to
     * by tasks, idea being rather than having loads of small files all can
     * be within this file
     */
    context: TroubleshootArtifactContext
}

/**
 * Represents a discrete task to be performed when composing the
 * troubleshooting artifact which contains pertinent information for debugging
 * issues encountered
 */
export type OutputTroubleshootArtifactTask = {
    /**
     * Executes a task required to compose part of the Troubleshooting artifact
     * @param options which the task can use to execute
     * @returns file created or undefined if no file created as part of task
     */
    run: (options: OutputTroubleshootArtifactTaskOptions) => Promise<string | undefined>;
}
