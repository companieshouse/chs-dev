import { services, modules } from "../utils/data";
import { Inventory } from "../../src/state/inventory";
import { expect, jest } from "@jest/globals";
import { moduleValidator, serviceValidator } from "../../src/helpers/validator";

const inventoryMock = {
    services,
    modules
} as Inventory;

const errorMock = jest.fn();

describe("serviceValidator", () => {
    let serviceValidatorUnderTest;

    beforeEach(() => {
        jest.resetAllMocks();

        serviceValidatorUnderTest = serviceValidator(inventoryMock, errorMock);
    });

    for (const serviceName of [null, undefined]) {
        it(`returns false when service name is ${serviceName}`, () => {
            expect(serviceValidatorUnderTest(serviceName)).toBe(false);
        });

        it(`calls error when service name is ${serviceName}`, () => {
            serviceValidatorUnderTest(serviceName);

            expect(errorMock).toHaveBeenCalledWith("Service must be provided");
        });
    }

    it("returns false when service not found", () => {
        expect(serviceValidatorUnderTest("service-one-hundred")).toBe(false);
    });

    it("calls error when service not found", () => {
        serviceValidatorUnderTest("service-one-hundred");

        expect(errorMock).toHaveBeenCalledWith("Service \"service-one-hundred\" is not defined in inventory");
    });

    it("returns true when not expecting repo and service found", () => {
        expect(serviceValidatorUnderTest("service-one")).toBe(true);
        expect(errorMock).not.toHaveBeenCalled();
    });

    it("returns false when service must have repository and no repository", () => {
        serviceValidatorUnderTest = serviceValidator(inventoryMock, errorMock, true);

        expect(serviceValidatorUnderTest("service-three")).toBe(false);
    });

    it("calls error when service must have repositry and no repository", () => {
        serviceValidatorUnderTest = serviceValidator(inventoryMock, errorMock, true);

        serviceValidatorUnderTest("service-three");

        expect(errorMock).toHaveBeenCalledWith("Service \"service-three\" does not have a git repository url defined");
    });
});

describe("moduleValidator", () => {
    let moduleValidatorUnderTest;

    beforeEach(() => {
        jest.resetAllMocks();

        moduleValidatorUnderTest = moduleValidator(inventoryMock, errorMock);
    });

    for (const moduleName of [null, undefined]) {
        it(`returns false when module name is ${moduleName}`, () => {
            expect(moduleValidatorUnderTest(moduleName)).toBe(false);
        });

        it(`calls error when module name is ${moduleName}`, () => {
            moduleValidatorUnderTest(moduleName);

            expect(errorMock).toHaveBeenCalledWith("Module must be provided");
        });
    }

    it("returns false when module not found", () => {
        expect(moduleValidatorUnderTest("module-one-hundred")).toBe(false);
    });

    it("calls error when module not found", () => {
        moduleValidatorUnderTest("module-one-hundred");

        expect(errorMock).toHaveBeenCalledWith("Module \"module-one-hundred\" is not defined in inventory");
    });

    it("returns true when not expecting repo and module found", () => {
        expect(moduleValidatorUnderTest("module-one")).toBe(true);
        expect(errorMock).not.toHaveBeenCalled();
    });

});
