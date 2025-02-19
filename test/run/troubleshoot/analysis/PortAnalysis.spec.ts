import { expect, jest } from "@jest/globals";
import yaml from "yaml";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import PortAnalysis from "../../../../src/run/troubleshoot/analysis/PortAnalysis";
import { modules, services } from "../../../utils/data";

jest.mock("fs");
jest.mock("yaml");

const inventoryMock = {
    services,
    modules
};

const stateManagerMock = {
    snapshot: {
        modules: [
            "module-one"
        ],
        services: [
            "service-one",
            "service-six"
        ],
        servicesWithLiveUpdate: [
            "service-two"
        ],
        excludedServices: [
            "service-four"
        ]
    }
};

describe("PortAnalysis", () => {
    let analysis: PortAnalysis;

    beforeEach(async () => {
        analysis = new PortAnalysis();
        jest.resetAllMocks();
    });

    it("should return an issue if enabled services ports overlaps or clashes", async () => {
        const analysisContext = {
            inventory: inventoryMock,
            stateManager: stateManagerMock,
            config: { }
        } as TroubleshootAnalysisTaskContext;

        const mockYaml = { services: { "service-one": { depends_on: [], ports: ["8080:8080"] }, "service-six": { depends_on: [], ports: ["8080:8080"] } } };
        (yaml.parse as jest.Mock).mockReturnValue(
            mockYaml
        );

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
    });

    it("should not return an issue if enabled services ports do not overlap or clash", async () => {
        const analysisContext = {
            inventory: inventoryMock,
            stateManager: stateManagerMock,
            config: { }
        } as TroubleshootAnalysisTaskContext;

        const mockYaml = { services: { "service-one": { depends_on: [], ports: ["8080:8080"] }, "service-six": { depends_on: [], ports: ["8081:8081"] } } };
        (yaml.parse as jest.Mock).mockReturnValue(
            mockYaml
        );

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

});
