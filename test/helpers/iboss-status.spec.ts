import { expect, jest, test } from "@jest/globals";
import { isIbossEnabled } from "./../../src/helpers/iboss-status.js";

describe("check the iboss flag is present", () => {
    afterEach(() => {
        delete process.env.CH_IBOSS_TRIAL;
    });

    test.each(["invalid", "undefined", "false"])("should return false when CH_IBOSS_TRIAL is %s", (ibossTrialEnvVar) => {
        process.env.CH_IBOSS_TRIAL = ibossTrialEnvVar;
        expect(isIbossEnabled()).toBe(false);
    });

    test.each(["true", "TRUE", "TrUe"])("should return true when CH_IBOSS_TRIAL is set to %s", (ibossTrialEnvVar) => {
        process.env.CH_IBOSS_TRIAL = ibossTrialEnvVar;
        expect(isIbossEnabled()).toBe(true);
    });

});
