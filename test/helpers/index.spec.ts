import { expect, test } from "@jest/globals";
import { findUniqueItemsInParentArray, isEmptyObject, isObjectFormat, matchExistInArrays } from "../../src/helpers";

describe("General Helper Functions", () => {

    describe("isEmptyObject", () => {
        it("should return true for empty object", () => {
            expect(isEmptyObject({})).toBe(true);
        });

        it("should return false for non-empty object", () => {
            expect(isEmptyObject({ key: "value" })).toBe(false);
        });
    });

    describe("isObjectFormat", () => {
        it("should return true for object format", () => {
            expect(isObjectFormat({})).toBe(true);
        });

        test.each([[], "string", 42, null])("should return false for when parameter is set to %s", (value) => {
            expect(isObjectFormat(value)).toBe(false);
        });

    });

    describe("findUniqueItemsInParentArray", () => {
        test("should return unique items from the first array", () => {
            const array1 = [1, 2, 3, 4];
            const array2 = [3, 4, 5, 6];
            expect(findUniqueItemsInParentArray(array1, array2)).toEqual([1, 2]);
        });

        test("should return all items when there are no common elements", () => {
            const array1 = ["a", "b", "c"];
            const array2 = ["x", "y", "z"];
            expect(findUniqueItemsInParentArray(array1, array2)).toEqual(["a", "b", "c"]);
        });

        test("should return an empty array when all items match", () => {
            const array1 = [10, 20, 30];
            const array2 = [10, 20, 30];
            expect(findUniqueItemsInParentArray(array1, array2)).toEqual([]);
        });

        test("should handle empty arrays correctly", () => {
            expect(findUniqueItemsInParentArray([], [1, 2, 3])).toEqual([]);
            expect(findUniqueItemsInParentArray([1, 2, 3], [])).toEqual([1, 2, 3]);
        });

        test("should handle mixed data types", () => {
            const array1 = [1, "two", true, null];
            const array2 = ["two", false, null];
            expect(findUniqueItemsInParentArray(array1, array2)).toEqual([1, true]);
        });
    });

    describe("matchExistInArrays", () => {
        test.each([
            [[1, 2, 3], [3, 4, 5]],
            [[100, 200, 300], [100, 200, 300]],
            [["two", true, null], ["two", false, null]]
        ])("should return true if there is at least one common element. array1: %s, array2: %s", (array1, array2) => {
            expect(matchExistInArrays(array1, array2)).toBe(true);
        });

        test("should return false if there are no common elements", () => {
            const array1 = ["a", "b", "c"];
            const array2 = ["x", "y", "z"];
            expect(matchExistInArrays(array1, array2)).toBe(false);
        });

        test.each([
            [[], []],
            [[1, 2, 3], []],
            [[], [1, 2, 3]]
        ])("should return false when either of the array is empty. array1: %s, array2: %s", (array1, array2) => {
            expect(matchExistInArrays(array1, array2)).toBe(false);
        });

    });
});
