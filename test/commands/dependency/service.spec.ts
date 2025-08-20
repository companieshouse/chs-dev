import { expect, jest } from "@jest/globals";
import Service from "../../../src/commands/dependency/service.js";
import { Config } from "@oclif/core";
import DependencyTree from "../../../src/run/dependency/dependency-tree.js";
import DependencyDiagram from "../../../src/run/dependency/dependency-diagram.js";

jest.mock("../../../src/run/dependency/dependency-diagram.js", () => {
    return jest.fn().mockImplementation(() => ({
        createDependencyDiagrams: jest.fn()
    }));
});

jest.mock("../../../src/run/dependency/dependency-tree.js");

jest.mock("../../../src/state/inventory", () => ({
    Inventory: function () {
        return { services: [{ name: "A", repository: { url: "test@git.com" } }] };
    }
}));

const dependencyTreeMock = {
    generateTree: jest.fn(),
    generateFlatTree: jest.fn()
};

const dependencyDiagramMock = {
    createDependencyDiagrams: jest.fn()
};

describe("Service Command", () => {
    let serviceCmd: Service;
    let mockConfig: Config;
    let logMock;
    let errorMock;

    let parseMock;

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        mockConfig = { root: "./", configDir: "./config", cacheDir: "./cache" };

        // @ts-expect-error
        DependencyTree.mockReturnValue(dependencyTreeMock);
        // @ts-expect-error
        DependencyDiagram.mockReturnValue(dependencyDiagramMock);

        serviceCmd = new Service(["A"], mockConfig);

        logMock = jest.spyOn(serviceCmd, "log");
        errorMock = jest.spyOn(serviceCmd, "error");

        // @ts-expect-error
        parseMock = jest.spyOn(serviceCmd, "parse");
    });

    it("calls generateTree for type 'tree'", async () => {
        (serviceCmd as any).flagValues = { type: "tree" };

        await (serviceCmd as any).handleValidService("A");
        expect(dependencyTreeMock.generateTree).toHaveBeenCalledWith("A");
    });

    it("calls generateFlatTree for type 'flattree'", async () => {
        (serviceCmd as any).flagValues = { type: "flattree" };
        await (serviceCmd as any).handleValidService("A");
        expect(dependencyTreeMock.generateFlatTree).toHaveBeenCalledWith("A");
    });

    it("calls createDependencyDiagrams for type 'diagram'", async () => {
        (serviceCmd as any).flagValues = { type: "diagram" };
        await (serviceCmd as any).handleValidService("A");
        expect(dependencyDiagramMock.createDependencyDiagrams).toHaveBeenCalledWith("A");
    });

    it("calls error for invalid type", async () => {
        (serviceCmd as any).flagValues = { type: "invalid" };
        (serviceCmd as any).error = jest.fn();
        await (serviceCmd as any).handleValidService("A");
        expect((serviceCmd as any).error).toHaveBeenCalledWith("'invalid' is not a valid value");
    });

    it("does nothing if flagValues is undefined", async () => {
        (serviceCmd as any).flagValues = undefined;
        await (serviceCmd as any).handleValidService("A");
        expect(dependencyTreeMock.generateTree).not.toHaveBeenCalled();
        expect(dependencyTreeMock.generateFlatTree).not.toHaveBeenCalled();
        expect(dependencyDiagramMock.createDependencyDiagrams).not.toHaveBeenCalled();
        expect(serviceCmd.error).not.toHaveBeenCalled();
    });

    it("parseArgumentsAndFlags delegates to parse", async () => {
        parseMock.mockResolvedValue(
            {
                argv: ["A"],
                flags: { type: "tree" }
            }
        );
        const result = await (serviceCmd as any).parseArgumentsAndFlags();
        expect(result).toEqual({ argv: ["A"], flags: { type: "tree" } });
        expect((serviceCmd as any).parse).toHaveBeenCalledWith(Service);
    });
});
