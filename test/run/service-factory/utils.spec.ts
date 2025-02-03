import { expect, test } from "@jest/globals";
import { applySelector, get } from "../../../src/run/service-factory/utils";

describe("applySelector", () => {

    const newServiceSpecWithSelector = {
        name: "my-new-service"
    };

    const newServiceSpecWithoutSelector = {};

    it("applies the value to the newServiceSpec at the selector", () => {
        const result = applySelector(newServiceSpecWithoutSelector, ".name", "my-new-service");

        expect(result).toEqual(newServiceSpecWithSelector);
    });

    it("applies value to sub object", () => {
        const result = applySelector(newServiceSpecWithoutSelector, ".configuration.docker-chs-development.module", "module");

        expect(result).toEqual({
            configuration: {
                "docker-chs-development": {
                    module: "module"
                }
            }
        });
    });

    test.each(["name", ".one[2]", ".two[\"three\"]"])("throws error when selector is %s", (selector) => {
        expect(() => applySelector(newServiceSpecWithoutSelector, selector, "my-new-service")).toThrowError();
    });
});

describe("get", () => {
    const newServiceSpec = {
        name: "my-new-service",
        configuration: {
            "docker-chs-development": {
                module: "module"
            }
        }
    };

    test.each([
        [".name", newServiceSpec.name],
        [
            ".configuration.docker-chs-development.module",
            newServiceSpec.configuration["docker-chs-development"].module
        ],
        [".type.name", undefined]
    ])("returns the value at the selector %s", (selector, expectedValue) => {
        const result = get(newServiceSpec, selector);

        expect(result).toEqual(expectedValue);
    });

    test.each(["name", ".one[2]", ".two[\"three\"]"])("throws error when selector is %s", (selector) => {
        expect(() => get(newServiceSpec, selector)).toThrowError();
    });
});
