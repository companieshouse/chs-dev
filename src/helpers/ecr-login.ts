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
