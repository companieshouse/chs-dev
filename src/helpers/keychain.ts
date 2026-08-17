import { spawn } from "./spawn-promise.js";
import { LogCapturingLogHandler } from "../run/logs/LogCapturingLogHandler.js";

/**
 * Retrieves the value of a generic password item from the local machine's OS keychain.
 *
 * Shells out to the macOS `security` command (`security find-generic-password`) to look up
 * the item by its service name, capturing stdout via a {@link LogCapturingLogHandler}.
 *
 * @param {string} key - The service name (`-s`) of the generic password item to look up in the keychain.
 * @returns { Promise<string | undefined> } - The retrieved secret value, or undefined if the item
 * does not exist, the command fails, or no output is produced.
 */
export const getItemFromKeyChain: (key: string) => Promise<string | undefined> = async (key: string): Promise<string | undefined> => {
    try {
        const logCapturingLogHandler = new LogCapturingLogHandler();
        const stderrLogCapturingLogHandler = new LogCapturingLogHandler();

        await spawn("security", ["find-generic-password", "-s", key, "-w"], {
            logHandler: logCapturingLogHandler,
            stderrLogHandler: stderrLogCapturingLogHandler
        });

        const logs = logCapturingLogHandler.getLogs();

        if (logs.length > 0) {
            return logs.join("");
        }
    } catch (error) {
        return undefined;
    }
};
