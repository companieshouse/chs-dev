import { basename, dirname } from "path";
import Service from "../model/Service.js";
import yaml from "yaml";
import { readFileSync } from "fs";

interface DependencySpecification {
    condition: "service_started" | "service_healthy" | "service_complete";
    restart?: boolean;
    required?: boolean;
}

interface DependencySpecificationMap {
    [dependency_name: string]: DependencySpecification;
}

interface ServiceDefinition {
    labels: string[];
    depends_on?: string[] | DependencySpecificationMap;
    healthcheck?: Record<string, any>;
}

/**
 * Parses a docker-compose.yaml file and creates a Service from it
 * @param filePath Docker Compose config file
 * @returns Partially complete Service with only direct dependencies
 */
export const readServices: (filePath: string) => Partial<Service>[] = (filePath: string) => {
    const module = basename(dirname(filePath));
    const services = yaml.parse(readFileSync(filePath).toString()).services as { [serviceName: string]: ServiceDefinition };
    const source = filePath;

    return Object.entries(services)
        .map(([serviceName, service]) => readService(module, source, serviceName, service));
};

const readService: (module: string, source: string, serviceName: string, service: ServiceDefinition) => Partial<Service> = (module, source, serviceName, service) => ({
    name: serviceName,
    module,
    source,
    description: findLabel(service.labels, "chs.description"),
    dependsOn: parseDependsOn(service.depends_on),
    repository: parseRepository(service.labels),
    builder: findLabel(service.labels, "chs.local.builder") || "",
    metadata: {
        repoContext: findLabel(service.labels, "chs.local.repoContext"),
        ingressRoute: findLabel(service.labels, "traefik.http.routers."),
        healthcheck: service.healthcheck?.test,
        languageMajorVersion: findLabel(service.labels, "chs.local.builder.languageVersion"),
        dockerfile: findLabel(service.labels, "chs.local.dockerfile")
    }
});

const findLabel = (labels: string[] | undefined, prefix: string) => {
    if (!labels) {
        return undefined;
    }

    const value = labels.find(label => label.startsWith(prefix));
    if (value) {
        return extractLabelValue(value);
    }
    return undefined;
};

const parseDependsOn: (dependencies?: string[] | DependencySpecificationMap) => string[] = (dependencies?: string[] | DependencySpecificationMap) =>
    dependencies
        ? Array.isArray(dependencies)
            ? dependencies
            : Object.keys(dependencies)
        : [];

const parseRepository = (labels: string[]) => {
    const repository = findLabel(labels, "chs.repository.url");

    return repository && repository !== null
        ? {
            url: repository,
            branch: findLabel(labels, "chs.repository.branch")
        }
        : null;
};

const extractLabelValue = (label: string) => {
    return label.substring(label.indexOf("=") + 1);
};
