import { AnalysisFailureLevel, AnalysisIssue } from "./AnalysisTask.js";

/**
 * Provides an implementation of an AnalysisOutcome for wrapping issues discovered as
 * a result of running analysis task
 */
export default class AnalysisOutcome {
    readonly headline: string;
    readonly issues: AnalysisIssue[];
    readonly level?: AnalysisFailureLevel;

    constructor (headline: string, issues: AnalysisIssue[], level?: AnalysisFailureLevel) {
        this.headline = headline;
        this.issues = issues;
        this.level = level;
    }

    isSuccess () {
        return this.issues.length === 0;
    }

    static createOutcome (headline: string, issues: AnalysisIssue[], level: AnalysisFailureLevel) {
        return new AnalysisOutcome(headline, issues, level);
    }
}
