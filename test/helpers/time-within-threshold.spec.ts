import { expect, jest } from "@jest/globals";
import fs from "fs";
import { ThresholdUnit, timeWithinThreshold } from "../../src/helpers/time-within-threshold";

const greaterThresholdTestCases: [string, number, string, ThresholdUnit][] = [
    ["2024-06-02T00:00:00.000Z", 2, "DAYS", ThresholdUnit.DAYS],
    ["2024-05-06T22:35:00.001Z", 2, "DAYS", ThresholdUnit.DAYS],
    ["2024-05-04T22:35:00.000Z", 2, "HOURS", ThresholdUnit.HOURS],
    ["2024-05-04T01:34:00.001Z", 2, "HOURS", ThresholdUnit.HOURS],
    ["2024-05-04T00:35:00.000Z", 2, "HOURS", ThresholdUnit.HOURS],
    ["2024-05-04T00:35:00.000Z", 2, "MINUTES", ThresholdUnit.MINUTES],
    ["2024-05-04T22:36:01.000Z", 2, "MINUTES", ThresholdUnit.MINUTES],
    ["2024-05-04T22:37:00.000Z", 2, "MINUTES", ThresholdUnit.MINUTES]
];

const lowerThresholdTestCases: [string, number, string, ThresholdUnit][] = [
    ["2024-05-03T22:34:00.432Z", 2, "DAYS", ThresholdUnit.DAYS],
    ["2024-05-03T22:35:00.000Z", 2, "DAYS", ThresholdUnit.DAYS],
    ["2024-05-04T22:34:00.432Z", 2, "DAYS", ThresholdUnit.DAYS],
    ["2024-05-05T00:34:00.432Z", 2, "DAYS", ThresholdUnit.DAYS],
    ["2024-05-05T21:34:00.432Z", 2, "DAYS", ThresholdUnit.DAYS],
    ["2024-05-03T22:34:00.432Z", 2, "HOURS", ThresholdUnit.HOURS],
    ["2024-05-04T00:34:00.000Z", 2, "HOURS", ThresholdUnit.HOURS],
    ["2024-05-03T23:34:00.432Z", 2, "HOURS", ThresholdUnit.HOURS],
    ["2024-05-03T00:33:59.999Z", 2, "HOURS", ThresholdUnit.HOURS],
    ["2024-05-03T22:34:00.432Z", 2, "MINUTES", ThresholdUnit.MINUTES],
    ["2024-05-03T22:34:30.432Z", 2, "MINUTES", ThresholdUnit.MINUTES],
    ["2024-05-03T22:35:30.432Z", 2, "MINUTES", ThresholdUnit.MINUTES],
    ["2024-05-03T22:35:59.999Z", 2, "MINUTES", ThresholdUnit.MINUTES]
];

const runTestCases = (expectedValue: boolean, difference: string, testCases: [string, number, string, ThresholdUnit][]) => {
    describe(`returns ${expectedValue} when ${difference}`, () => {
        for (const [executionTime, value, unitName, unit] of testCases) {
            it(`comparing value ${difference} ${unitName} (${executionTime}, ${value} ${unitName})`, () => {
                expect(timeWithinThreshold(
                    "./comparisonfile",
                    Date.parse(executionTime as string),
                    value as number,
                    unit as ThresholdUnit
                )).toBe(expectedValue);
            });
        }
    });
};

describe("timeWithinThreshold", () => {
    const readFileSyncSpy = jest.spyOn(fs, "readFileSync");

    const comparisonFileValue = "2024-05-03T22:34:00.432Z";

    beforeEach(() => {
        jest.resetAllMocks();

        readFileSyncSpy.mockReturnValue(
            Buffer.from(comparisonFileValue, "utf8")
        );
    });

    it("reads file supplied", () => {
        timeWithinThreshold(
            "./comparisonfile",
            Date.parse("2021-01-01T09:00:00.999Z"),
            2,
            ThresholdUnit.DAYS
        );

        expect(readFileSyncSpy).toHaveBeenCalledWith("./comparisonfile");
    });

    it("can handle dates as input", () => {
        expect(timeWithinThreshold(
            "./comparisonfile",
            new Date(Date.parse("2029-01-01T09:00:00.999Z")),
            2,
            ThresholdUnit.DAYS
        )).toBe(false);
    });

    runTestCases(false, "greater", greaterThresholdTestCases);

    runTestCases(true, "lower", lowerThresholdTestCases);
});
