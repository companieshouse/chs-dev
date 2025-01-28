import type { MatcherFunction } from "expect";
import { AnalysisIssue } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import { expect } from "@jest/globals";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";

const outcomeIncludesIssue: MatcherFunction<[issue: AnalysisIssue]> = (actual, expectedIssue) => {
    if (typeof actual === "undefined" || !(actual instanceof AnalysisOutcome)) {
        throw new TypeError("Must be of AnalysisOutcome type");
    }

    const hasExpectedIssue = actual.issues.some(
        issue => expectedIssue.title === issue.title &&
            expectedIssue.description === issue.description &&
            expectedIssue.documentationLinks.reduce((acc, next) =>
                acc && issue.documentationLinks.includes(next), true) &&
            expectedIssue.suggestions.reduce((acc, next) =>
                acc && issue.suggestions.includes(next), true)
    );

    return {
        message: () => `Expected: ${JSON.stringify(expectedIssue, null, 2)}\nTo be within: ${JSON.stringify(actual.issues, null, 2)}`,
        pass: hasExpectedIssue
    };
};

expect.extend({ outcomeIncludesIssue });

declare module "expect" {
    interface AsymmetricMatchers {
        outcomeIncludesIssue(issue: AnalysisIssue): void
    }

    interface Matchers<R> {
        outcomeIncludesIssue(issue: AnalysisIssue): R;

    }
}
