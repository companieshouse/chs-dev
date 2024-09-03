import { Hook } from "@oclif/core";

import { load } from "../helpers/config-loader.js";
import { isOnVpn } from "../helpers/vpn-check.js";
import { VersionCheck } from "../run/version-check.js";
import { hookFilter } from "./hook-filter.js";

export const hook: Hook<"init"> = async function (options) {

    if (!hookFilter(options.id, options.argv)) {
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
