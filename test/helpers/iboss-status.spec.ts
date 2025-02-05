import { expect, jest, test } from "@jest/globals";
import { isIbossEnabled } from "./../../src/helpers/iboss-status.js";

describe("check the iboss flag is present", () => {
    afterEach(() => {
        delete process.env.CH_IBOSS_TRIAL;
    });

    it("should return false when CH_IBOSS_TRIAL is unset", async () => {
        delete process.env.CH_IBOSS_TRIAL;
        expect(isIbossEnabled()).toBe(false);
    });

    it("should return false when CH_IBOSS_TRIAL is set to empty", async () => {
        process.env.CH_IBOSS_TRIAL = "";
        expect(isIbossEnabled()).toBe(false);
    });

    test.each(["false", "0", "no"])("should return false when CH_IBOSS_TRIAL is %s", (ibossTrialEnvVar) => {
        process.env.CH_IBOSS_TRIAL = ibossTrialEnvVar;
        expect(isIbossEnabled()).toBe(false);
    });

    test.each(["true", "1", "anything", "valid"])("should return true when CH_IBOSS_TRIAL is set to %s", (ibossTrialEnvVar) => {
        process.env.CH_IBOSS_TRIAL = ibossTrialEnvVar;
        expect(isIbossEnabled()).toBe(true);
    });

});
