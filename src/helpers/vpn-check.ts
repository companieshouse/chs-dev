import { execSync } from "child_process";

const webproxyHost = "websenseproxy.internal.ch";
const statisticsPattern = /received,\s([^%]+%).packet.loss/;

/**
 * Checks whether current machine can access the internal proxy server, if so
 * it would indicate that they are able to access internal services.
 * @returns boolean indicating whether the current machine can access the proxy
 */
export const isOnVpn = () => {
    try {
        const stdout = execSync(`ping -c 3 ${webproxyHost}`).toString("utf8");

        const statisticsMatches = stdout.match(statisticsPattern);

        if (statisticsMatches) {
            const matchPercentage = statisticsMatches[1];

            if (matchPercentage !== "100.0%") {
                return true;
            }
        }

    } catch (error) {
        console.error(`Error occurred when checking VPN Status: ${(error as Error).message}`);
    }
    return false;
};
