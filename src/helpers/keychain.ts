import { spawn } from "./spawn-promise.js";
import { LogCapturingLogHandler } from "../run/logs/LogCapturingLogHandler.js";

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
