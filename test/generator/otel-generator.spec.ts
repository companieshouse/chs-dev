import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { OtelGenerator } from "../../src/generator/otel-generator";
import { DockerComposeSpec } from "../../src/model/DockerComposeSpec";

import * as path from "path";
import * as yaml from "yaml";

jest.mock("fs");
jest.mock("yaml");

const CONSTANTSMOCK = {
    OTEL_DOCKER_COMPOSE_FILE: "services/infrastructure/open-telemetry/open-telemetry.docker-compose.yaml"
};

const mockDockerCompose: DockerComposeSpec = {
    include: [],
    services: {
        "ingress-proxy": {
            depends_on: {}
        }
    }
};

jest.mock("../../src/helpers/docker-compose-file", () => ({
    getGeneratedDockerComposeFile: jest.fn(() => mockDockerCompose)
}));

describe("OtelGenerator", () => {
    let otelGenerator: OtelGenerator;
    const testPath = "/tmp/test";
    let mockOtelServices: Record<string, any>;

    beforeEach(() => {
        jest.clearAllMocks();
        otelGenerator = new OtelGenerator(testPath);
        mockOtelServices = {
            services: {
                "otel-collector": { depends_on: [] },
                loki: { depends_on: [] },
                tempo: { depends_on: [] },
                init: {}
            }
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should include OTEL services when otel flag is true", () => {
        mockDockerCompose.include = [path.join(testPath, CONSTANTSMOCK.OTEL_DOCKER_COMPOSE_FILE)];
        (otelGenerator as any).modifyIncludeProperties = jest.fn().mockReturnValue(mockDockerCompose);
        mockDockerCompose.services["ingress-proxy"].depends_on = {
            "otel-collector": { condition: "service_started", restart: true },
            loki: { condition: "service_started", restart: true },
            tempo: { condition: "service_started", restart: true }
        };
        (otelGenerator as any).modifyDependencies = jest.fn().mockReturnValue(mockDockerCompose);
        (otelGenerator as any).writeFile = jest.fn();
        (yaml.stringify as jest.Mock).mockReturnValue("mock-yaml-content");

        otelGenerator.modifyGeneratedDockerCompose({ otel: true });

        expect((otelGenerator as any).modifyIncludeProperties).toHaveBeenCalledWith("add");
        expect((otelGenerator as any).modifyDependencies).toHaveBeenCalledWith(mockDockerCompose, "add");
        expect((otelGenerator as any).writeFile).toHaveBeenCalled();
    });

    it("should exclude OTEL services when no-otel flag is true", () => {
        (otelGenerator as any).modifyIncludeProperties = jest.fn().mockReturnValue(mockDockerCompose);
        (otelGenerator as any).modifyDependencies = jest.fn().mockReturnValue(mockDockerCompose);
        (otelGenerator as any).writeFile = jest.fn();
        (yaml.stringify as jest.Mock).mockReturnValue("mock-yaml-content");

        otelGenerator.modifyGeneratedDockerCompose({ "no-otel": true });

        expect((otelGenerator as any).modifyIncludeProperties).toHaveBeenCalledWith("remove");
        expect((otelGenerator as any).modifyDependencies).toHaveBeenCalledWith(mockDockerCompose, "remove");
        expect((otelGenerator as any).writeFile).toHaveBeenCalled();
    });

    it("should exclude OTEL services when no flag is set", () => {
        (otelGenerator as any).modifyIncludeProperties = jest.fn().mockReturnValue(mockDockerCompose);
        (otelGenerator as any).modifyDependencies = jest.fn().mockReturnValue(mockDockerCompose);
        (otelGenerator as any).writeFile = jest.fn();
        (yaml.stringify as jest.Mock).mockReturnValue("mock-yaml-content");

        otelGenerator.modifyGeneratedDockerCompose(undefined);

        expect((otelGenerator as any).modifyIncludeProperties).toHaveBeenCalledWith("remove");
        expect((otelGenerator as any).modifyDependencies).toHaveBeenCalledWith(mockDockerCompose, "remove");
        expect((otelGenerator as any).writeFile).toHaveBeenCalled();
    });

    it("should return otel service names except 'init'", () => {
        (yaml.parse as jest.Mock).mockReturnValue(
            mockOtelServices
        );
        expect(otelGenerator.otelServiceNames).toEqual(["otel-collector", "loki", "tempo"]);
    });

    it("should get OTEL services from file", () => {
        (yaml.parse as jest.Mock).mockReturnValue(
            mockOtelServices
        );
        const services = (otelGenerator as any).getOtelServices();
        expect(services).toEqual(mockOtelServices.services);
    });

    it("should get OTEL docker compose file path", () => {
        const filePath = (otelGenerator as any).getOtelDockerComposeFilePath();
        expect(filePath).toBe(path.join(testPath, CONSTANTSMOCK.OTEL_DOCKER_COMPOSE_FILE));
    });

    it("should add OTEL services to depends_on when action is 'add'", () => {
        (yaml.parse as jest.Mock).mockReturnValue(
            mockOtelServices
        );
        const result = (otelGenerator as any).modifyDependencies(mockDockerCompose, "add");
        expect(result.services["ingress-proxy"].depends_on["otel-collector"]).toBeDefined();
        expect(result.services["ingress-proxy"].depends_on.loki).toBeDefined();
        expect(result.services["ingress-proxy"].depends_on.tempo).toBeDefined();
    });

    it("should remove OTEL services from depends_on when action is 'remove'", () => {
        (yaml.parse as jest.Mock).mockReturnValue(
            mockOtelServices
        );
        mockDockerCompose.services["ingress-proxy"].depends_on = {
            "otel-collector": { condition: "service_started", restart: true },
            loki: { condition: "service_started", restart: true },
            tempo: { condition: "service_started", restart: true }
        };
        const result = (otelGenerator as any).modifyDependencies(mockDockerCompose, "remove");
        expect(result.services["ingress-proxy"].depends_on["otel-collector"]).toBeUndefined();
        expect(result.services["ingress-proxy"].depends_on.loki).toBeUndefined();
        expect(result.services["ingress-proxy"].depends_on.tempo).toBeUndefined();
    });

    it("should add otel docker compose file to include when action is 'add'", () => {
        const result = (otelGenerator as any).modifyIncludeProperties("add");

        expect(result.include).toContain(path.join(testPath, CONSTANTSMOCK.OTEL_DOCKER_COMPOSE_FILE));
    });

    it("should remove otel docker compose file from include when action is 'remove'", () => {
        mockDockerCompose.include = [path.join(testPath, CONSTANTSMOCK.OTEL_DOCKER_COMPOSE_FILE)];

        const result = (otelGenerator as any).modifyIncludeProperties("remove");
        expect(result.include).not.toContain(path.join(testPath, CONSTANTSMOCK.OTEL_DOCKER_COMPOSE_FILE));
    });
});
