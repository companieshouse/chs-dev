import { existsSync } from "fs";
import { join } from "path";
import { ThresholdUnit, timeWithinThreshold } from "./time-within-threshold.js";

export interface EcrLoginWithinThresholdProperties {
   chsDevDataDir: string;
   projectName: string;
   performEcrLoginHoursThreshold: number;
   lastRunTimeFile?: string;
   executionTime?: number;
}

/**
 * Checks if the `CHS_DEV_FORCE_ECR_CHECK` environment variable is set.
 *
 * @returns {boolean} - `true` if the environment variable is set, `false` otherwise.
 */
export const isForceEcrCheckEnabled = (): boolean => {
    return "CHS_DEV_FORCE_ECR_CHECK" in process.env;
};

/**
 * Determines whether the user has a valid ECR login within a specified time threshold.
 *
 * This function checks if a recorded login timestamp exists and if it falls within the
 * allowed threshold (in hours) from the current execution time.
 *
 *   @param {EcrLoginWithinThresholdProperties} params - The properties required for the check:
 *   @param {string} chsDevDataDir - The directory where the last run time file is located.
 *   @param {string} projectName - The name of the project, used to determine the file path if `lastRunTimeFile` is not provided.
 *   @param {number} performEcrLoginHoursThreshold - The threshold (in hours) to check if the login is still valid.
 *   @param {string} [lastRunTimeFile] - An optional file path for the last run time; if not provided, it is derived.
 *   @param {number} [executionTime] - An optional execution time to compare against; defaults to the current time.
 *
 * @returns {boolean} - `true` if a valid ECR login exists within the threshold, `false` otherwise.
 */

export const hasValidEcrLoginWithinThreshold: (EcrLoginWithinThresholdProperties) => boolean = ({ chsDevDataDir, projectName, performEcrLoginHoursThreshold, lastRunTimeFile: runTimefile, executionTime: currentTime }) => {
    const executionTime = currentTime ?? Date.now();

    const lastRunTimeFile = runTimefile ?? join(chsDevDataDir, `${projectName}.prerun.last_run_time`);

    const lastRuntimeExists = existsSync(lastRunTimeFile);

    return lastRuntimeExists && timeWithinThreshold(
        lastRunTimeFile,
        executionTime,
        performEcrLoginHoursThreshold as number,
        ThresholdUnit.HOURS
    );

};
