import Config from "../../../model/Config.js";
import { Inventory } from "../../../state/inventory.js";
import { StateManager } from "../../../state/state-manager.js";

export type TroubleshootAnalysisTaskContext = {
    inventory: Inventory,
    stateManager: StateManager,
    config: Config,
}

/**
 * Describes the level of failure - which will describe how the troubleshooter
 * will respond to the failure
 */
export enum AnalysisFailureLevel {

    /**
     * An issue which could cause issues for the environment and so should be
     * investigated further
     */
    WARN,
    /**
     * A critical error which must be addressed and is going to be responsible
     * for issues within the environment.
     */
    FAIL,
    /**
     * Will output a message to the user but will not cause the troubleshoot
     * analyses to fail
     */
    INFO
}

export type AnalysisIssue = {
    title: string,
    description: string,
    suggestions: string[],
    documentationLinks: string[],
}

export type AnalysisTaskOutcome = {
    headline: string,

    level?: AnalysisFailureLevel

    issues: AnalysisIssue[],

    isSuccess(): boolean
}

/**
 * A task which performs an analysis of the state which produces an outcome
 */
export type AnalysisTask = {

    analyse(context: TroubleshootAnalysisTaskContext): Promise<AnalysisTaskOutcome>;
}

export default AnalysisTask;
