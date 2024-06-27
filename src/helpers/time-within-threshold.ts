import { readFileSync } from "fs";

export enum ThresholdUnit {
    MINUTES = 1000 * 60,
    HOURS = 1000 * 60 * 60,
    DAYS = 1000 * 60 * 60 * 24
}

/**
 * Determines whether the ISO date stored within the file date supplied is
 * within the supplied threshold of the date within file `comparisonFile`
 * @param comparisonFile: string - path to file containing ISO date to compare
 *              the executionTime to
 * @param executionTime: Date | number - value to compare to the value in file
 *              which must be within the defined threshold
 * @param thresholdValue: number - number of units which define the acceptable
 *              theshold
 * @param thresholdUnit: ThresholdUnit - The unit of the threshold being tested
 * @returns boolean indicating whether exectutionTime is within the threshold
 * supplied
 */
export const timeWithinThreshold = (
    comparisonFile: string,
    executionTime: Date | number,
    thresholdValue: number,
    thresholdUnit: ThresholdUnit
) => {
    let withinThreshold: boolean = true;

    const lastRun = readFileSync(comparisonFile).toString("utf8");

    if (executionTime instanceof Date) {
        executionTime = executionTime.getTime();
    }

    const difference = executionTime - Date.parse(lastRun);

    const numberOfUnitsLapsed = Math.floor(
        difference / thresholdUnit
    );

    if (numberOfUnitsLapsed >= thresholdValue) {
        withinThreshold = false;
    }

    return withinThreshold;
};
