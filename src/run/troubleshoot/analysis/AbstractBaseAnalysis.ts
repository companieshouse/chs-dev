import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, AnalysisFailureLevel } from "./AnalysisTask.js";

export default abstract class BaseAnalysis {
    /**
     * Creates an AnalysisOutcome based on the provided issues and level.
     *
     * @param headline - The headline for the analysis outcome.
     * @param issues - The issues found during the analysis. Can be a single issue, multiple issues, or undefined.
     * @param level - The severity level for the outcome: "Warn", "Fail", or "Info".
     * @returns An AnalysisOutcome instance based on the provided parameters or a successful outcome.
     */
    protected createOutcomeFrom (
        headline: string,
        issues: AnalysisIssue[] | AnalysisIssue | undefined,
        level?: "Warn" | "Fail" | "Info"
    ): AnalysisOutcome {
        const normalizedIssues = issues ? (Array.isArray(issues) ? issues : [issues]) : [];

        if (normalizedIssues.length > 0) {
            const failureLevel =
                level === "Info"
                    ? AnalysisFailureLevel.INFO
                    : level === "Fail"
                        ? AnalysisFailureLevel.FAIL
                        : AnalysisFailureLevel.WARN;

            return AnalysisOutcome.createOutcome(headline, normalizedIssues, failureLevel);
        }

        // No issues, return a successful outcome
        return new AnalysisOutcome(headline, []);
    }

}
