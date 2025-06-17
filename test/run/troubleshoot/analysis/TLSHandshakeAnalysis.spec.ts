import { expect, jest } from "@jest/globals";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import * as fs from "fs";
import TLSHandshakeAnalysis from "../../../../src/run/troubleshoot/analysis/TLSHandshakeAnalysis";
import { join } from "path";

jest.mock("fs");

const SUGGESTIONS = [
    "Run: `COMPOSE_PARALLEL_LIMIT=1 chs-dev up`",
    "to resolve the issue then",
    "Run: 'rm -r ./local/.logs/' to clear logs."
];
const DOCUMENTATION_LINKS = [
    "troubleshooting-remedies/correctly-set-docker-compose-parallel-limit-variable.md"
];

describe("TLSHandshakeAnalysis", () => {
    let analysis: TLSHandshakeAnalysis;

    const mockProjectPath = "/mock/project";
    const mockDate = "2025-06-16";
    const mockLogPath = join(
        mockProjectPath,
        `local/.logs/compose.out.${mockDate}.txt`
    );

    beforeEach(async () => {
        jest.spyOn(global, "Date").mockImplementation(() =>
            ({
                toISOString: () => `${mockDate}T12:00:00.000Z`
            } as unknown as Date)
        );

        analysis = new TLSHandshakeAnalysis();
        jest.resetAllMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should return an AnalysisOutcome with issue if TLS handshake timeout is found", async () => {
        const logContent = [
            "Some log line",
            "Another log line",
            "TLS handshake timeout",
            "Yet another log line",
            "Final log line"
        ].join("\n");

        (fs.readFileSync as jest.Mock).mockReturnValue(logContent);

        const outcome = await analysis.analyse({
            config: { projectPath: mockProjectPath }
        } as any);

        expect(fs.readFileSync).toHaveBeenCalledWith(mockLogPath, "utf-8");
        expect(outcome.headline).toContain("TLS Handshake Timeout Errors");
        expect(outcome.issues).toHaveLength(1);
        expect(outcome.issues[0].title).toContain("TLS Handshake Error");
        expect(outcome.issues[0].suggestions).toContain(
            "Run: `COMPOSE_PARALLEL_LIMIT=1 chs-dev up`"
        );
    });

    // it("should return an AnalysisOutcome with no issues if TLS handshake timeout is not found", async () => {
    //     const logContent = [
    //         "Some log line",
    //         "Another log line",
    //         "No handshake error here",
    //         "Yet another log line",
    //         "Final log line"
    //     ].join("\n");

    //     (fs.readFileSync as jest.Mock).mockReturnValue(logContent);

    //     const tlsHandshake = new TLSHandshake();
    //     const outcome = await tlsHandshake.analyse({
    //         config: { projectPath: mockProjectPath }
    //     } as any);

    //     expect(fs.readFileSync).toHaveBeenCalledWith(mockLogPath, "utf-8");
    //     expect(outcome.headline).toContain("TLS Handshake Timeout Errors");
    //     expect(outcome.issues).toHaveLength(0);
    //     expect(outcome.status).toBe("Fail");
    // });

    // it("should handle empty log files gracefully", async () => {
    //     (fs.readFileSync as jest.Mock).mockReturnValue("");

    //     const tlsHandshake = new TLSHandshake();
    //     const outcome = await tlsHandshake.analyse({
    //         config: { projectPath: mockProjectPath }
    //     } as any);

    //     expect(outcome.issues).toHaveLength(0);
    // });
});
