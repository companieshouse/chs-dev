import { expect, jest } from "@jest/globals";
import { isIbossEnabled } from "./../../src/helpers/iboss-status.js";

describe("check the iboss flag is present", () => {
    afterEach(() => {
        delete process.env.CH_IBOSS_TRIAL;
    });
    it("should return true when CH_IBOSS_TRIAL is set to 'true' (case insensitive)", () => {
        process.env.CH_IBOSS_TRIAL = "true";
        expect(isIbossEnabled()).toBe(true);
    });

    it("should return false when CH_IBOSS_TRIAL is set to 'false'", () => {
        process.env.CH_IBOSS_TRIAL = "false";
        expect(isIbossEnabled()).toBe(false);
    });

    it("should return false when CH_IBOSS_TRIAL is undefined", () => {
        expect(isIbossEnabled()).toBe(false);
    });

    it("should return false when CH_IBOSS_TRIAL is set to an invalid value", () => {
        process.env.CH_IBOSS_TRIAL = "invalid";
        expect(isIbossEnabled()).toBe(false);
    });

    it("should return true when CH_IBOSS_TRIAL is set to uppercase 'TRUE'", () => {
        process.env.CH_IBOSS_TRIAL = "TRUE";
        expect(isIbossEnabled()).toBe(true);
    });

    it("should return true when CH_IBOSS_TRIAL is set to mixed case 'TrUe'", () => {
        process.env.CH_IBOSS_TRIAL = "TrUe";
        expect(isIbossEnabled()).toBe(true);
    });

});
