import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import Config from "../model/Config.js";
import { diff, satisfies } from "semver";
import { getLatestReleaseVersion } from "../helpers/latest-release.js";
import { join } from "path";
import { ThresholdUnit, timeWithinThreshold } from "../helpers/time-within-threshold.js";

type VersionCheckLogger = {
    warn: (msg: string) => void;
    info: (msg: string) => void;
}

type CreateArguments = {
    dataDirectory: string;
    runThresholdDays: number;
    logger: VersionCheckLogger;
    config: Config;
}

/**
 * A class which checks the version of the project and logs out any
 * inconsistencies to latest version or project version
 */
export class VersionCheck {

    // eslint-disable-next-line no-useless-constructor
    private constructor (private readonly dataDirectory: string,
        private readonly runThresholdDays: number,
        private readonly logger: VersionCheckLogger,
        private readonly config: Config
    ) {

    }

    /**
     * Runs version check checking the supplied version is approprate for the
     * project and also whether a more recent version is available
     * @param applicationVersion version to check
     * @returns Promise representing outcome - resolves to undefined when
     * successful and rejects when there is an error
     */
    async run (applicationVersion: string) {
        const isEnvVarSet = (envVarName: string) => envVarName in process.env;

        if (!isEnvVarSet("CHS_DEV_NO_PROJECT_VERSION_MISMATCH_WARNING") &&
            !this.isSuitableVersionForProject(applicationVersion)) {

            this.logUnsuitableVersion(applicationVersion, this.config.versionSpecification as string);

            return;
        }

        const runTimeFile = join(this.dataDirectory, "last-version-run-time");
        const executionTime = Date.now();

        if (!timeWithinThreshold(runTimeFile, executionTime, this.runThresholdDays, ThresholdUnit.DAYS)) {
            await this.checkCurrentVersionOfCliIsLatest(applicationVersion);

            writeFileSync(
                runTimeFile,
                new Date(executionTime).toISOString()
            );
        }

    }

    /**
     * Creates a VersionCheck object ensuring the dataDir is present when it is
     * absent
     * @param argumentsObject - containing the properties to create the
     * VersionCheck object
     * @returns new VersionCheck object
     */
    static create (
        {
            dataDirectory,
            runThresholdDays,
            logger,
            config
        }: CreateArguments
    ): VersionCheck {
        if (!existsSync(dataDirectory)) {
            mkdirSync(dataDirectory, { recursive: true });
        }

        return new VersionCheck(dataDirectory, runThresholdDays, logger, config);
    }

    private logUnsuitableVersion (actualVersion: string, requiredVersionSpecification: string) {
        const sepLine = "-".repeat(80);
        this.logger.warn(
            `WARNING: this version: ${actualVersion} does not meet the project requirements: ${requiredVersionSpecification}

Run:

\tchs-dev sync

to update chs-dev to a suitable version
${sepLine}

`
        );
    };

    private isSuitableVersionForProject (applicationVersion: string): boolean {
        return !this.config.versionSpecification || satisfies(applicationVersion, this.config.versionSpecification); ;
    }

    private async checkCurrentVersionOfCliIsLatest (applicationVersion) {
        const latestVersion = await getLatestReleaseVersion();

        const semverDifference = diff(latestVersion, applicationVersion);

        if (semverDifference !== null) {
            this.logVersionDifference(latestVersion, applicationVersion, semverDifference);
        }
    };

    private logVersionDifference (latestVersion: string, currentVersion: string, semverDifference: string) {
        const versionDifference: string = semverDifference === "major" || semverDifference === "minor"
            ? ` ${semverDifference}`
            : "";

        const sepLine = "=".repeat(80);
        const versionOutOfDateMessage = `📣 There is a newer${versionDifference} version (${latestVersion}) available (current version: ${currentVersion})

Run:

\tchs-dev sync

to update to latest version
`;

        this.logger.info(
            `${sepLine}\n\n${versionOutOfDateMessage}\n\n${sepLine}`
        );
    };

}
