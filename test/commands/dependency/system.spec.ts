import { expect, jest } from "@jest/globals";
import System from "../../../src/commands/dependency/system.js";

import DependencyDiagram from "../../../src/run/dependency/dependency-diagram.js";
import { DependencyObjectType } from "../../../src/model/DependencyGraph.js";
import { modules, services } from "../../utils/data.js";
import { Inventory } from "../../../src/state/inventory.js";

jest.mock("../../../src/state/inventory.js");
jest.mock("../../../src/run/dependency/dependency-diagram.js", () => {
    return jest.fn().mockImplementation(() => ({
        createSystemDiagram: jest.fn()
    }));
});

const inventoryMock = {
    services,
    modules
} as Inventory;

const dependencyDiagramMock = {
    createSystemDiagram: jest.fn()
};

describe("System Command", () => {
    let cmd: System;
    let mockConfig: any;

    beforeEach(() => {
        jest.resetAllMocks();
        mockConfig = { cacheDir: "/mock/cache" };
        // @ts-expect-error
        Inventory.mockReturnValue(inventoryMock);

        // @ts-expect-error
        DependencyDiagram.mockReturnValue(dependencyDiagramMock);

        cmd = new System([], mockConfig);
        cmd.log = jest.fn();
    });

    it("constructs with correct DependencyDiagram type", () => {
        expect((cmd as any).diagram).toBeDefined();
        expect(DependencyDiagram).toHaveBeenCalledWith(
            DependencyObjectType.SYSTEM,
            expect.any(Function)
        );
    });

    it("run calls createSystemDiagram with inventory", async () => {
        await cmd.run();
        expect(dependencyDiagramMock.createSystemDiagram).toHaveBeenCalledWith(inventoryMock);
    });
});
