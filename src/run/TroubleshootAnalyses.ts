import { writeFileSync } from "fs";
import { simpleColouriser } from "../helpers/colouriser.js";
import Config from "../model/Config.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { Logger } from "./logs/logs-handler.js";
import analysisTasks from "./troubleshoot/analysis/analysis-tasks.js";
import AnalysisTask, { AnalysisFailureLevel, AnalysisIssue, AnalysisTaskOutcome } from "./troubleshoot/analysis/AnalysisTask.js";

export type AnalysesOutome = {
    success: boolean
}

type PerformOptions = {
    quiet?: boolean,
    fileOut?: string
}

/**
 * Provides analyses regarding the user's environment with the hope they have
 * pointers to resolve their issues.
 */
export default class TroubleshootAnalyses {

    private readonly analysisTasks: AnalysisTask[];
    private readonly inventory: Inventory;
    private readonly stateManager: StateManager;
    private readonly config: Config;
    private readonly logger: Logger;

    constructor (
        analysisTasks: AnalysisTask[],
        inventory: Inventory,
        stateManager: StateManager,
        config: Config,
        logger: Logger
    ) {
        this.analysisTasks = analysisTasks;
        this.inventory = inventory;
        this.stateManager = stateManager;
        this.config = config;
        this.logger = logger;
    }

    /**
     * Performs the analyses on the environment based on the tasks it has
     * been configured with logging helpful output to the terminal
     * @param options - when quiet supplied will not output to terminal, when
     *      fileOut supplied writes analyses to the path supplied at the end
     * @returns outcome of the result
     */
    async perform ({ quiet, fileOut }: PerformOptions): Promise<AnalysesOutome> {
        const log = quiet === true ? (msg: string) => { } : this.logger.log;

        const analysisContext = {
            inventory: this.inventory,
            config: this.config,
            stateManager: this.stateManager
        };

        const analysesOutcome = await Promise.all(this.analysisTasks.map((task) => task.analyse(analysisContext)));

        let outcome: boolean = true;

        if (!analysesOutcome.some(outcome => !outcome.isSuccess())) {
            log(`${simpleColouriser("SUCCESS!", "bold-green")} No issues found with your docker environment`);
            log(simpleColouriser("If there are still problems with your environment create a report and seek support", "grey"));
        } else {
            log("There were issues found with your environment");

            const failedAnalysisTasks = analysesOutcome
                .filter(outcome => !outcome.isSuccess());

            failedAnalysisTasks
                .forEach((outcome) => this.logAnalysisOutcome(log, outcome));

            outcome = this.allInformationalStatuses(failedAnalysisTasks);
        }

        if (typeof fileOut !== "undefined") {
            writeFileSync(
                fileOut,
                JSON.stringify({
                    analysisResults: analysesOutcome
                        .map(({ headline, issues, level }) => ({
                            [headline]: {
                                criticality: this.describeLevel(level)[0],
                                issues
                            }
                        }))
                        .reduce((acc, next) => ({ ...acc, ...next }), {})
                })
            );
        }

        return {
            success: outcome
        };
    }

    static create (
        inventory: Inventory,
        stateManager: StateManager,
        config: Config,
        logger: Logger
    ) {
        return new TroubleshootAnalyses(
            analysisTasks,
            inventory,
            stateManager,
            config,
            logger
        );
    }

    private describeLevel (level?: AnalysisFailureLevel) {
        let description: [string, "bold-red" | "yellow" | "cyan" | "grey"];

        switch (level) {
        case AnalysisFailureLevel.FAIL:
            description = ["CRITICAL", "bold-red"];
            break;
        case AnalysisFailureLevel.WARN:
            description = ["WARNING", "yellow"];
            break;
        case AnalysisFailureLevel.INFO:
            description = ["QUERY", "cyan"];
            break;
        default:
            description = ["NONE", "grey"];
            break;
        }

        return description;

    }

    private allInformationalStatuses (analysesOutcome: AnalysisTaskOutcome[]): boolean {
        return analysesOutcome
            .map(outcome => outcome.level)
            .reduce((acc, next) => acc && next === AnalysisFailureLevel.INFO, true);
    }

    private logAnalysisOutcome (logFn: (msg: string) => void, outcome: AnalysisTaskOutcome) {
        const [label, colour] = this.describeLevel(outcome.level);

        logFn(`${simpleColouriser(label, colour)} - ${outcome.headline}:`);
        outcome.issues.forEach(issue => this.logIssue(logFn, issue));
    }

    private logIssue (logFn: (msg: string) => void, issue: AnalysisIssue) {
        logFn(`\t* ${issue.title}:`);
        logFn(`\t\t${issue.description}\n`);
        logFn("\t\tSuggestions:");
        issue.suggestions.forEach(suggestion => logFn(`\t\t\t- ${suggestion}`));
        logFn("\n\t\tDocumentation Links:");
        issue.documentationLinks.forEach(docLink => logFn(`\t\t\t- ${this.documentationLink(docLink)}`));

    }

    private documentationLink (documentationFileName: string) {
        return `https://www.github.com/companieshouse/chs-dev/blob/main/docs/${documentationFileName}`;
    }
}
