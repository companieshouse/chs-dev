import { expect, jest } from "@jest/globals";
import { IdentifyingCommandOutputTroubleshootArtifactTask } from "../../../../src/run/troubleshoot/artifact/identifying-command-output-troubleshoot-artifact-task";
import { input as inputMock } from "../../../../src/helpers/user-input";
import fs from "fs";
import { join } from "path";

jest.mock("../../../../src/helpers/user-input");

describe("identifyingCommandOutputTroubleshootArtifactTask", () => {
    let identifyingCommandOutputTroubleshootArtifactTask: IdentifyingCommandOutputTroubleshootArtifactTask;
    const outputDirectory = "/tmp/chs-dev-23456";
    const taskContext = {
        append: jest.fn()
    };
    const taskOptions = {
        outputDirectory, context: taskContext
    };

    beforeEach(() => {
        jest.resetAllMocks();

        identifyingCommandOutputTroubleshootArtifactTask = new IdentifyingCommandOutputTroubleshootArtifactTask();
    });

    it("asks for command that failed", async () => {
        // @ts-expect-error
        inputMock.mockResolvedValue("chs-dev up");

        await identifyingCommandOutputTroubleshootArtifactTask.run(taskOptions);

        expect(inputMock).toHaveBeenCalledWith("What command was it that failed (please be exact)?");
    });

    it("appends command to context", async () => {
        // @ts-expect-error
        inputMock.mockResolvedValue("chs-dev up");

        await identifyingCommandOutputTroubleshootArtifactTask.run(taskOptions);

        expect(taskContext.append).toHaveBeenCalledWith({
            command: "chs-dev up"
        });
    });

    it("prompts again if initial prompt not supplied", async () => {
        // @ts-expect-error
        inputMock.mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce("")
            .mockResolvedValueOnce("   ")
            .mockResolvedValue("chs-dev up");

        await identifyingCommandOutputTroubleshootArtifactTask.run(taskOptions);

        expect(inputMock).toBeCalledTimes(4);
    });

});
