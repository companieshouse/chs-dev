import { expect } from "@jest/globals";
import { isEmptyObject, isObjectFormat } from "../../src/helpers";

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

        it("should return false for array", () => {
            expect(isObjectFormat([])).toBe(false);
        });

        it("should return false for non-object values", () => {
            expect(isObjectFormat("string")).toBe(false);
            expect(isObjectFormat(42)).toBe(false);
            expect(isObjectFormat(null)).toBe(false);
        });
    });
});
