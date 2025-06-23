import { readFileSync } from "fs";
import { join } from "path";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

const ANALYSIS_HEADLINE = "Checks TLS Handshake Timeout Errors and enforce proper COMPOSE_PARALLEL_LIMIT configuration";

const SUGGESTIONS = [
    "Run: `COMPOSE_PARALLEL_LIMIT=1 chs-dev up`",
    "to resolve the issue then",
    "Run: 'rm -r ./local/.logs/' to clear logs."
];

const DOCUMENTATION_LINKS = [
    "troubleshooting-remedies/correctly-set-docker-compose-parallel-limit-variable.md"
];

/**
 * An analysis task that evaluates whether the logs shows a TLS handshake timeout error and suggest a resolution.
 */
export default class TLSHandshake extends BaseAnalysis {

    async analyse ({ config: { projectPath } }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const tlsIssue = this.checkDockerLogsForTLSHandshakeTimeoutError(projectPath);

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, tlsIssue, "Fail");
    }

    /**
     * Checks the Docker logs for TLS handshake timeout errors.
     * @param {string} projectPath - Path to the project repository
     * @returns { Promise<AnalysisIssue | undefined> } - an AnalysisIssue if such an error is found in the last 5 log lines, otherwise undefined.
     */
    private checkDockerLogsForTLSHandshakeTimeoutError (projectPath): AnalysisIssue | undefined {
        const currentDate = new Date().toISOString().slice(0, 10);
        const daylogFile = `local/.logs/compose.out.${currentDate}.txt`;
        const localLogs = join(projectPath, daylogFile);
        const logContent = readFileSync(localLogs, "utf-8");

        // Extract the last 5 log lines
        const logLines = logContent.trim().split("\n");
        const last5LogOutput = logLines.slice(-5).join("\n");
        if (last5LogOutput.includes("TLS handshake timeout")) {

            return this.createIssue(
                "TLS Handshake Error Found in Docker Logs",
                "Ensure 'COMPOSE_PARALLEL_LIMIT' environment variable is set to 1. This is necessary to avoid TLS handshake timeout errors when running multiple services in parallel.",
                SUGGESTIONS,
                DOCUMENTATION_LINKS
            );
        }
        return undefined;
    }

}
