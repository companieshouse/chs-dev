import { Hook } from "@oclif/core";

import { load } from "../helpers/config-loader.js";
import { isOnVpn, isWebProxyHostSet } from "../helpers/vpn-check.js";
import { VersionCheck } from "../run/version-check.js";
import { hookFilter } from "./hook-filter.js";
import LogEverythingLogHandler from "../run/logs/LogEverythingLogHandler.js";
import { spawn } from "../helpers/spawn-promise.js";
import { isIbossEnabled } from "../helpers/iboss-status.js";

const mutuallyExclusiveCommands = [
    "up",
    "down"
];

export const hook: Hook<"init"> = async function (options) {

    if (!hookFilter(options.id, options.argv)) {
        return;
    }

    if (mutuallyExclusiveCommands.includes(options.id || "") && await anyOtherProcessesRunning()) {
        options.context.error(
            "There are other chs-dev processes running. Wait for them to complete or stop them before retrying"
        );
        return;
    }

    await options.config.runHook("validate-project-state", {
        requiredFiles: [
            "services"
        ]
    });

    const projectConfig = load();

    const networkIssueMessage = handleNetworkConditions();
    if (networkIssueMessage) {
        this.warn(networkIssueMessage);
    }

    const versionCheck = VersionCheck.create({
        dataDirectory: options.config.dataDir,
        runThresholdDays: parseInt(options.config.pjson["chs-dev"]["version-check-schedule"]["number-of-days"]),
        config: projectConfig,
        logger: {
            warn: (msg) => this.warn(msg),
            info: (msg) => this.log(msg)
        }
    });

    await versionCheck.run(options.config.version);

};

const anyOtherProcessesRunning = async () => {
    try {
        await spawn(
            "pgrep",
            [
                "-fq",
                "docker compose .*(watch|up|down)"
            ],
            {
                logHandler: new LogEverythingLogHandler({
                    log: (_) => {}
                })
            }
        );
        return true;
    } catch (exception) {
        return false;
    }
};

/**
 * Checks the current network conditions and returns a warning message if any issues are detected.
 * This function verifies whether the necessary network conditions are met for container builds to work correctly.
 * It checks for the following conditions in order:
 * 1. If iBoss (a network security service) is enabled, the function exits early.
 * 2. Ensures the `CH_PROXY_HOST` environment variable is set.
 * 3. Confirms that the system is connected to the VPN.
 *
 * @returns {string | undefined} A warning message describing the network issue if found, otherwise `undefined` if all conditions are met.
 */
const handleNetworkConditions = (): string | undefined => {

    if (isIbossEnabled()) return;

    if (!isWebProxyHostSet()) {
        return "CH_PROXY_HOST env not set. Some containers may not build properly.";
    }

    if (!isOnVpn()) {
        return "Not on VPN. Some containers may not build properly.";
    }
};
