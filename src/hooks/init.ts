import { Hook } from "@oclif/config";

import { minVersion, satisfies, gt, parse } from "semver";
import { engines } from "../../package.json";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { getLatestReleaseVersion } from "../helpers/latest-release.js";
import { join } from "path";

export const hook: Hook<"init"> = async function (options) {
    let checkVersion: boolean = "CHS_DEV_CHECK_VERSION" in process.env;
    
    const executionTime = Date.now()

    const runTimeFile = join(options.config.dataDir, "last-version-run-time")

    if (!existsSync(options.config.dataDir)) {
        mkdirSync(options.config.dataDir, {recursive: true});

        checkVersion = true;
    } else if (!existsSync(runTimeFile)) {
        checkVersion = true
    }else {
        const lastRun = readFileSync(runTimeFile).toString("utf8");

        const difference = executionTime - Date.parse(lastRun)

        const numberOfDaysLapsed = Math.floor(
            difference / (60 * 60 * 24 * 1000)
        )

        if (numberOfDaysLapsed >= parseInt(options.config.pjson["chs-dev"]["version-check-schedule"]["number-of-days"])) {
            checkVersion = true
        }
    }


    if (checkVersion) {
        const latestVersion = await getLatestReleaseVersion()

        if (gt(latestVersion, options.config.version)) {
            const latestVersionSemver = parse(latestVersion);
            const versionSemver = parse(options.config.version);
            let versionDifference = "";

            if (latestVersionSemver?.major != versionSemver?.major) {
                versionDifference = " major"
            } else if (latestVersionSemver?.minor != versionSemver?.minor) {
                versionDifference = " minor"
            }

            console.log(
                "=".repeat(80)
            )

            console.log(
                `\n📣 There is a newer${versionDifference} version (${latestVersion}) available (current version: ${options.config.version})\n`
            )

            console.log(
                "=".repeat(80)
            )
        }

        writeFileSync(
            runTimeFile,
            new Date(executionTime).toISOString()
        )
    }

};
