import CONSTANTS from "../model/Constants.js";
import { spawn } from "./spawn-promise.js";
import { LogCapturingLogHandler } from "../run/logs/LogCapturingLogHandler.js";

const PERMITTED_KEYCHAIN_ITEMS = [
    CONSTANTS.SSH_PASSWORD_KEYCHAIN_ITEM_NAME
];

/**
 * Retrieves an allow-listed generic password from the macOS keychain.
 */
export const getItemFromKeyChain = async (key: string): Promise<string | undefined> => {
    if (!PERMITTED_KEYCHAIN_ITEMS.includes(key)) {
        throw new Error(`Requested keychain item "${key}" is not permitted to be read.`);
    }

    const stdout = new LogCapturingLogHandler();
    const stderr = new LogCapturingLogHandler();

    try {
        await spawn("security", ["find-generic-password", "-s", key, "-w"], {
            logHandler: stdout,
            stderrLogHandler: stderr
        });
    } catch (_error) {
        return undefined;
    }

    const value = stdout.getLogs().join("");
    return value.length > 0 ? value.trimEnd() : undefined;
};
