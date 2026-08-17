import { spawn } from "./spawn-promise.js";
import { LogCapturingLogHandler } from "../run/logs/LogCapturingLogHandler.js";
import CONSTANTS from "../model/Constants.js";

/**
 * The list of keychain item names that {@link getItemFromKeyChain} is permitted to read.
 * Any request for a key not present in this list will result in an error being thrown,
 * preventing arbitrary secrets from being read from the OS keychain.
 */
const PERMITTED_KEYCHAIN_ITEMS: string[] = [
    CONSTANTS.SSH_PASSWORD_KEYCHAIN_ITEM_NAME
];

/**
 * Retrieves the value of a generic password item from the local machine's OS keychain.
 *
 * Shells out to the macOS `security` command (`security find-generic-password`) to look up
 * the item by its service name, capturing stdout via a {@link LogCapturingLogHandler}.
 *
 * Only keys listed in {@link PERMITTED_KEYCHAIN_ITEMS} may be requested; any other key will
 * cause this function to throw an error.
 *
 * @param {string} key - The service name (`-s`) of the generic password item to look up in the keychain.
 * @returns { Promise<string | undefined> } - The retrieved secret value, or undefined if the item
 * does not exist, the command fails, or no output is produced.
 * @throws { Error } - When the requested key is not one of the permitted keychain items.
 */
export const getItemFromKeyChain: (key: string) => Promise<string | undefined> = async (key: string): Promise<string | undefined> => {
    if (!PERMITTED_KEYCHAIN_ITEMS.includes(key)) {
        throw new Error(`Requested keychain item "${key}" is not permitted to be read.`);
    }

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
