import { expect, jest } from "@jest/globals";
import os from "os";
import AnalysisOutcome from "../../../../src/run/troubleshoot/analysis/AnalysisOutcome";
import DockerMemoryAnalysis from "../../../../src/run/troubleshoot/analysis/DockerMemoryAnalysis";
import { TroubleshootAnalysisTaskContext } from "../../../../src/run/troubleshoot/analysis/AnalysisTask";
import { fetchDockerSettings } from "../../../../src/helpers/docker-settings-store";
import { modules, services } from "../../../utils/data";

jest.mock("os");
jest.mock("../../../../src/helpers/docker-settings-store", () => ({
    fetchDockerSettings: jest.fn()
}));

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
            "service-six",
            "service-one"
        ],
        servicesWithLiveUpdate: [
            "service-two",
            "service-ten",
            "service-nine"
        ],
        excludedServices: [
            "service-four"
        ]
    }
};

describe("DockerMemoryAnalysis", () => {
    let analysis: DockerMemoryAnalysis;
    const analysisContext = {
        inventory: inventoryMock,
        stateManager: stateManagerMock,
        config: {
            projectPath: "/home/user/docker",
            projectName: "docker",
            env: {}
        }
    } as TroubleshootAnalysisTaskContext;

    beforeEach(async () => {
        analysis = new DockerMemoryAnalysis();
        jest.resetAllMocks();

    });

    it("should return a successful outcome if docker memory is >12GB", async () => {
        const mockDockerSettings = {
            OverrideProxyHTTP: "http://proxy.example.com",
            OverrideProxyHTTPS: "http://proxy.example.com",
            ProxyHttpMode: "manual",
            ProxyHTTPMode: "manual",
            MemoryMiB: 16000
        };

        (fetchDockerSettings as jest.Mock).mockReturnValue(mockDockerSettings);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

    it("should return a false outcome if docker memory is <12GB not half the device memory", async () => {
        const mockDockerSettings = {
            OverrideProxyHTTP: "http://proxy.example.com",
            OverrideProxyHTTPS: "http://proxy.example.com",
            ProxyHttpMode: "manual",
            ProxyHTTPMode: "manual",
            MemoryMiB: 10240 // 10GB
        };

        (fetchDockerSettings as jest.Mock).mockReturnValue(mockDockerSettings);

        // set device memory to 36GB
        (os.totalmem as jest.Mock).mockReturnValue(38654705664);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
    });

    it("should return a truthy outcome if docker memory is <12GB and half the device memory", async () => {
        const mockDockerSettings = {
            OverrideProxyHTTP: "http://proxy.example.com",
            OverrideProxyHTTPS: "http://proxy.example.com",
            ProxyHttpMode: "manual",
            ProxyHTTPMode: "manual",
            MemoryMiB: 8192 // 8GB
        };

        (fetchDockerSettings as jest.Mock).mockReturnValue(mockDockerSettings);

        // set device memory to 16GB
        (os.totalmem as jest.Mock).mockReturnValue(17179869184);

        const outcome = await analysis.analyse(analysisContext);

        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(true);
    });

    it("should return an issue if docker memory is less than 12GB and half the device memory, an intensive service is enabled or the number of enabled services threshold is exceeded", async () => {
        const mockDockerSettings = {
            OverrideProxyHTTP: "http://proxy.example.com",
            OverrideProxyHTTPS: "http://proxy.example.com",
            ProxyHttpMode: "manual",
            ProxyHTTPMode: "manual",
            MemoryMiB: 8192 // 8GB
        };

        (fetchDockerSettings as jest.Mock).mockReturnValue(mockDockerSettings);

        // set device memory to 16GB
        (os.totalmem as jest.Mock).mockReturnValue(17179869184);

        Object.defineProperty(DockerMemoryAnalysis, "ENABLED_SERVICE_COUNT_THRESHOLD", {
            value: 5,
            writable: false
        });
        Object.defineProperty(DockerMemoryAnalysis, "ENABLED_RESOURCE_INTENSIVE_SERVICES", {
            value: ["redis", "service-one"],
            writable: false
        });

        const outcome = await analysis.analyse(analysisContext);
        expect(outcome).toBeInstanceOf(AnalysisOutcome);
        expect(outcome.isSuccess()).toBe(false);
    });

});
