import { Hook } from "@oclif/config";

import { diff, satisfies } from "semver";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { getLatestReleaseVersion } from "../helpers/latest-release.js";
import { join } from "path";
import { load } from "../helpers/config-loader.js";
import Config from "../model/Config.js";

export const hook: Hook<"init"> = async function (options) {

    const projectConfig = load();

    if (!isEnvVarSet("CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING") &&
        !isSuitableVersionForProject(options.config.version, projectConfig)) {

        logUnsuitableVersion(options.config.version, projectConfig.versionSpecification as string);

        return;
    }

    const runTimeFile = join(options.config.dataDir, "last-version-run-time");
    const executionTime = Date.now();
    const runThresholdDays = options.config.pjson["chs-dev"]["version-check-schedule"]["number-of-days"];

    const dataDirectoryExists = existsSync(options.config.dataDir);

    const checkVersion: boolean = isEnvVarSet("CHS_DEV_CHECK_VERSION") || !(
        dataDirectoryExists && existsSync(runTimeFile) && hasBeenRunRecently(executionTime, runThresholdDays, runTimeFile)
    );

    if (!dataDirectoryExists) {
        mkdirSync(options.config.dataDir, { recursive: true });
    }

    if (checkVersion) {
        await checkCurrentVersionOfCliIsLatest(options);

        writeFileSync(
            runTimeFile,
            new Date(executionTime).toISOString()
        );
    }

};

const isSuitableVersionForProject = (version: string, projectConfig: Config) => {
    return !projectConfig.versionSpecification || satisfies(version, projectConfig.versionSpecification);
};

const hasBeenRunRecently: (executionTime: number, dayThreshold: string, runTimeFile: string) => boolean = (executionTime: number, dayThreshold: string, runTimeFile: string) => {
    let runRecently: boolean = true;

    const lastRun = readFileSync(runTimeFile).toString("utf8");

    const difference = executionTime - Date.parse(lastRun);

    const numberOfDaysLapsed = Math.floor(
        difference / (60 * 60 * 24 * 1000)
    );

    if (numberOfDaysLapsed >= parseInt(dayThreshold)) {
        runRecently = false;
    }

    return runRecently;
};

const checkCurrentVersionOfCliIsLatest = async (options) => {
    const latestVersion = await getLatestReleaseVersion();
    const currentVersion = options.config.version;

    const semverDifference = diff(latestVersion, currentVersion);

    if (semverDifference !== null) {
        logVersionDifference(latestVersion, currentVersion, semverDifference);
    }
};

const logVersionDifference = (latestVersion: string, currentVersion: string, semverDifference: string) => {
    const versionDifference: string = semverDifference === "major" || semverDifference === "minor"
        ? ` ${semverDifference}`
        : "";

    const sepLine = "=".repeat(80);
    const versionOutOfDateMessage = `📣 There is a newer${versionDifference} version (${latestVersion}) available (current version: ${currentVersion})

Run:

\tchs-dev sync

to update to latest version
`;

    console.log(
        `${sepLine}\n\n${versionOutOfDateMessage}\n\n${sepLine}`
    );
};

const isEnvVarSet = (envVarName: string) => envVarName in process.env;

const logUnsuitableVersion = (actualVersion: string, requiredVersionSpecification: string) => {
    const sepLine = "-".repeat(80);
    console.log(
        `WARNING: this version: ${actualVersion} does not meet the project requirements: ${requiredVersionSpecification}

Run:

\tchs-dev sync

to update chs-dev to a suitable version
${sepLine}

`
    );
};
