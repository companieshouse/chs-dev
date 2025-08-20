import { expect, jest } from "@jest/globals";
import * as fs from "fs";
import { join } from "path";
import TLSHandshakeAnalysis from "../../../../src/run/troubleshoot/analysis/TLSHandshakeAnalysis";

jest.mock("fs");

describe("TLSHandshakeAnalysis", () => {
    let analysis: TLSHandshakeAnalysis;

    const mockProjectPath = "/mock/project";
    const mockDate = "2025-06-16";
    const mockLogPath = join(
        mockProjectPath,
        `local/.logs/compose.out.${mockDate}.txt`
    );

    beforeEach(async () => {
        jest.resetAllMocks();
        jest.useFakeTimers().setSystemTime(new Date(`${mockDate}T12:00:00.000Z`));
        analysis = new TLSHandshakeAnalysis();
        (fs.existsSync as jest.Mock).mockReturnValue(true);
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

    it("should return an AnalysisOutcome with no issues if TLS handshake timeout is not found", async () => {
        const logContent = [
            "Some log line",
            "Another log line",
            "No handshake error here",
            "Yet another log line",
            "Final log line"
        ].join("\n");

        (fs.readFileSync as jest.Mock).mockReturnValue(logContent);

        const outcome = await analysis.analyse({
            config: { projectPath: mockProjectPath }
        } as any);

        expect(fs.readFileSync).toHaveBeenCalledWith(mockLogPath, "utf-8");
        expect(outcome.headline).toContain("TLS Handshake Timeout Errors");
        expect(outcome.issues).toHaveLength(0);
    });

    it("should handle empty log files gracefully", async () => {
        (fs.readFileSync as jest.Mock).mockReturnValue("");

        const outcome = await analysis.analyse({
            config: { projectPath: mockProjectPath }
        } as any);

        expect(outcome.issues).toHaveLength(0);
    });

    it("should handle non-existent log file gracefully", async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        const outcome = await analysis.analyse({
            config: { projectPath: mockProjectPath }
        } as any);

        expect(outcome.issues).toHaveLength(0);
    });
});
