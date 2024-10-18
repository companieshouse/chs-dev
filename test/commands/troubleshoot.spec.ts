import { expect, jest } from "@jest/globals";
import { Troubleshooter } from "../../src/run/troubleshooter";
import TroubleshootCommand from "../../src/commands/troubleshoot";
import { Config } from "@oclif/core";

const troubleshooterMock = {
    attemptResolution: jest.fn(),
    outputTroubleshootArtifact: jest.fn()
};

jest.mock("../../src/run/troubleshooter");

describe("troubleshoot", () => {

    let troubleshootCommand: TroubleshootCommand;
    let parseSpy;
    const outputDirectory = "/home/user/output";
    beforeEach(() => {
        jest.resetAllMocks();

        troubleshootCommand = new TroubleshootCommand([], {
            cacheDir: "/home/user/.cache/chs-dev"
        } as Config);

        // @ts-expect-error
        troubleshootCommand.troubleshooter = troubleshooterMock;

        // @ts-expect-error
        parseSpy = jest.spyOn(troubleshootCommand, "parse");

        parseSpy.mockResolvedValue({
            flags: {
                noGuide: false
            },
            args: {
                outputDirectory
            }
        });

        troubleshooterMock.attemptResolution.mockResolvedValue(true as never);
    });

    // @ts-expect-error
    it.each([
        {
            guide: true
        },
        {
            guide: false
        }
    ])("calls troubleshooter attemptResolution with guide $guide", async ({ guide }) => {
        parseSpy.mockResolvedValue({
            flags: {
                noGuide: guide
            },
            args: {
                outputDirectory
            }
        });

        await troubleshootCommand.run();

        expect(troubleshooterMock.attemptResolution).toHaveBeenCalledWith(guide);
    });

    it("calls troubleshooter output artifact when attemptResolution is false", async () => {
        await troubleshootCommand.run();

        expect(troubleshooterMock.outputTroubleshootArtifact).toHaveBeenCalledWith(
            outputDirectory
        );
    });
});
