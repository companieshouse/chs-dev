import { expect, jest } from "@jest/globals";
import * as fs from "fs";
import { hasValidEcrLoginWithinThreshold, EcrLoginWithinThresholdProperties } from "../../src/helpers/ecr-login";
import { timeWithinThreshold } from "../../src/helpers/time-within-threshold";

jest.mock("fs");
jest.mock("../../src/helpers/time-within-threshold", () => ({
    timeWithinThreshold: jest.fn(),
    ThresholdUnit: {
        MINUTES: 1000 * 60,
        HOURS: 1000 * 60 * 60,
        DAYS: 1000 * 60 * 60 * 24
    }
}));

describe("ecr-login", () => {

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("should return a truthy value if login is within threshold", () => {
        const ecrLoginCheckProperties = {
            projectName: "ecr-login",
            performEcrLoginHoursThreshold: 7,
            chsDevDataDir: "/mock/path/data.dir",
            executionTime: Date.now()
        } as EcrLoginWithinThresholdProperties;
        (fs.existsSync as jest.Mock).mockReturnValue(true); // lastRunTimeFile exist
        (timeWithinThreshold as jest.Mock).mockReturnValue(true); // threshold not exceeded

        const result = hasValidEcrLoginWithinThreshold(ecrLoginCheckProperties);
        expect(result).toBe(true);
    });

    it("should return a falsy value if login doesnt exist or is not within threshold", () => {
        const ecrLoginCheckProperties = {
            projectName: "ecr-login",
            performEcrLoginHoursThreshold: 7,
            chsDevDataDir: "/mock/path/data.dir",
            executionTime: Date.now()
        } as EcrLoginWithinThresholdProperties;
        (fs.existsSync as jest.Mock).mockReturnValue(false); // lastRunTimeFile doesnt exist
        (timeWithinThreshold as jest.Mock).mockReturnValue(false); // threshold exceeded

        const result = hasValidEcrLoginWithinThreshold(ecrLoginCheckProperties);
        expect(result).toBe(false);
    });

});
