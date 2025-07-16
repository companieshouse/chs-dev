import { expect, jest } from "@jest/globals";
import Add from "../../../src/commands/exclusions/add";
import { services } from "../../utils/data";

const addExclusionForServiceMock = jest.fn();
const logMock = jest.fn();
const getServiceDirectDependenciesMock = jest.fn();

jest.mock("./../../../src/run/service-loader", () => ({
    ServiceLoader: function () {
        return {
            getServiceDirectDependencies: getServiceDirectDependenciesMock,
            loadServicesNames: jest.fn().mockReturnValue(["service-one", "service-two", "service-three"])
        };
    }

}));

jest.mock("../../../src/state/inventory", () => ({
    Inventory: function () {
        return { services };
    }
}));

jest.mock("../../../src/state/state-manager", () => ({
    StateManager: function () {
        return {
            addExclusionForService: addExclusionForServiceMock,
            snapshot: {
                excludedServices: ["service-three"]
            }
        };
    }
}));

describe("exclusions add (full coverage)", () => {
    let exclusionsAdd: Add;
    let parseMock: jest.SpiedFunction<any>;
    let handlePreHookCheckMock;
    let handleServiceModuleStateHookMock: jest.SpiedFunction<any>;

    beforeEach(() => {
        jest.resetAllMocks();
        exclusionsAdd = new Add([], { runHook: jest.fn() } as any);
        (exclusionsAdd as any).log = logMock;
        parseMock = jest.spyOn(exclusionsAdd as any, "parse");
        handleServiceModuleStateHookMock = jest.spyOn(exclusionsAdd as any, "handleServiceModuleStateHook");
        handlePreHookCheckMock = jest.spyOn(exclusionsAdd as any, "preHookCheckWarnings").mockReturnValue(undefined);
        getServiceDirectDependenciesMock.mockReturnValue(["service-four"]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should log and exclude a service (no dependencies)", async () => {
        parseMock.mockResolvedValue({ args: { service: "service-nine" }, argv: ["service-nine"] });
        await exclusionsAdd.run();
        expect(addExclusionForServiceMock).toHaveBeenCalledWith("service-nine");
        expect(logMock).toHaveBeenCalledWith(expect.stringContaining("excluded"));
    });

    it("should handle dependency exclusion and log all messages", async () => {
        parseMock.mockResolvedValue({ args: { service: "service-two" }, argv: ["service-two"], flags: { dependency: true } });
        await exclusionsAdd.run();
        expect(logMock).toHaveBeenCalledWith(expect.stringContaining("dependencies"));
        expect(addExclusionForServiceMock).toHaveBeenCalledWith("service-two");
    });

    it("should log when no dependencies found", async () => {
        parseMock.mockResolvedValue({ args: { service: "service-nine" }, argv: ["service-nine"], flags: { dependency: true } });
        getServiceDirectDependenciesMock.mockReturnValue([]);
        await exclusionsAdd.run();
        expect(logMock).toHaveBeenCalledWith(expect.stringContaining("No dependencies found"));
    });

    it("should log dependency message if dependency is elsewhere", async () => {
        parseMock.mockResolvedValue({ args: { service: "service-four" }, argv: ["service-four"], flags: { dependency: true } });
        await exclusionsAdd.run();
        expect(logMock).toHaveBeenCalledWith(expect.stringContaining("dependencies"));
        expect(logMock).toHaveBeenCalledWith(expect.stringContaining("cannot be excluded"));
    });

    it("should call handlePreHookCheck and skip if warning returned", async () => {
        parseMock.mockResolvedValue({ args: { service: "service-one" }, argv: ["service-one"] });
        handleServiceModuleStateHookMock.mockResolvedValue("Warning");
        const result = await (exclusionsAdd as any).handlePreHookCheck(["service-one"]);
        expect(result).toBe("Warning");
    });

    it("should call handlePreHookCheck and continue if no warning", async () => {
        parseMock.mockResolvedValue({ args: { service: "service-one" }, argv: ["service-one"] });
        handleServiceModuleStateHookMock.mockResolvedValue(undefined);
        const result = await (exclusionsAdd as any).handlePreHookCheck(["service-one"]);
        expect(result).toBeUndefined();
    });

    it("should return correct dependency message", () => {
        const msg = (exclusionsAdd as any).handleDependencyMessages("serviceX", "serviceY");
        expect(msg).toContain("serviceY");
        expect(msg).toContain("serviceX");
    });

    it("should call handleExcludeAndLog and return correct message", () => {
        const msg = (exclusionsAdd as any).handleExcludeAndLog("serviceZ");
        expect(msg).toContain("serviceZ");
        expect(addExclusionForServiceMock).toHaveBeenCalledWith("serviceZ");
    });
});
