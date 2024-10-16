import { input } from "../../../helpers/user-input.js";

/**
 * An OutputTroubleshootArtifactTask which will prompt the user to supply the
 * command that failed and write it to the troubleshooting context
 */
export class IdentifyingCommandOutputTroubleshootArtifactTask {
    async run ({
        context
    }): Promise<string | undefined> {
        let failingCommand: string;
        while (true) {
            failingCommand = await input(
                "What command was it that failed (please be exact)?"
            );

            if (typeof failingCommand !== "undefined" && /\S/.test(failingCommand)) {
                break;
            }

            console.error(
                "Please enter a value for failing command."
            );
        }

        context.append({
            command: failingCommand
        });

        return undefined;
    }
}

export default new IdentifyingCommandOutputTroubleshootArtifactTask();
