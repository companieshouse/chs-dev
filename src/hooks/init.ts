import { Hook } from "@oclif/core";

import { load } from "../helpers/config-loader.js";
import { isOnVpn } from "../helpers/vpn-check.js";
import { VersionCheck } from "../run/version-check.js";
import { hookFilter } from "./hook-filter.js";
import LogEverythingLogHandler from "../run/logs/LogEverythingLogHandler.js";
import { spawn } from "../helpers/spawn-promise.js";

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

    if (!isOnVpn()) {
        this.warn("Not on VPN. Some containers may not build properly.");
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
