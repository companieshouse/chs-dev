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

const metadataLabelMapping = {
    repoContext: "chs.local.repoContext",
    // The escaped \. indicates a partial label and so this is not a
    // useless escape
    // eslint-disable-next-line no-useless-escape
    ingressRoute: "traefik.http.routers\.",
    languageMajorVersion: "chs.local.builder.languageVersion",
    dockerfile: "chs.local.dockerfile",
    entrypoint: "chs.local.entrypoint",
    buildOutputDir: "chs.local.builder.outputDir",
    secretsRequired: "chs.local.builder.requiresSecrets",
    repositoryRequired: "chs.local.repositoryRequired",
    builderUseServiceDockerFile: "chs.local.builder.useServiceDockerfile"
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
        ...readLabels(service.labels),
        healthcheck: service.healthcheck?.test
    }
});

/**
 * Searches for label which satisfies the prefixRegex within the supplied
 * labels
 * @param labels list of labels or undefined when no labels defined
 * @param prefixRegex a regex expression (as string) which when found at
 *      start of label indicates the label which is desired. A partial
 *      prefix will end with a '\.'
 * @returns value of the matched label or undefined if a matching label
 * could not be found or there were no labels
 */
const findLabel = (labels: string[] | undefined, prefixRegex: string) => {
    if (!labels) {
        return undefined;
    }

    // Check whether the prefix is a complete or partial label name (i.e.
    // partial would have a trailing dot) and append '=' to prefix when
    // prefix is complete
    // eslint-disable-next-line no-useless-escape
    if (!prefixRegex.endsWith("\.")) {
        prefixRegex += "=";
    }

    const labelKeyRegex = new RegExp(`^${prefixRegex}.+$`);

    const value = labels.find(label => labelKeyRegex.test(label));
    if (value) {
        return extractLabelValue(value);
    }
    return undefined;
};

const readLabels = (serviceLabels: string[]) => {
    const metadata: Record<string, string> = {};

    for (const [metadataKey, label] of Object.entries(metadataLabelMapping)) {
        const labelValue = findLabel(serviceLabels, label);

        if (labelValue) {
            metadata[metadataKey] = labelValue;
        }
    }

    return metadata;
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
