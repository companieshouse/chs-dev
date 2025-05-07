import { Hook } from "@oclif/core";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import loadConfig from "../helpers/config-loader.js";
import yaml from "yaml";
import {
    logDocumentationLink,
    validateLabelForSubmodulesIntegration,
    validateNodemonEntryContent,
    validateNodemonJsonContent,
    validateNodePackageJson
} from "../helpers/development-mode-validators.js";
import Service from "../model/Service.js";

// @ts-ignore
export const hook: Hook<"check-development-service-config"> = async ({ services, context }: { services: Service[] }) => {
    const projectPath = loadConfig().projectPath;

    for (const service of services) {
        if (service.builder === "node") {
            checkNodeServiceConfig(service, projectPath, context);
        } else if (service.builder === "java" || !service.builder) {
            checkServiceHealthCheckConfig(service, context);
        }
    }
};

/**
* Checks the health status for Non Node Applications
* @param service - Service object.
* @param context - Context for logging messages.
* @returns {void}
*/
const checkServiceHealthCheckConfig = (service: Service, context) => {
    const dockerCompose = yaml.parse(readFileSync(service.source, "utf-8"));
    const healthCheckProperty = dockerCompose.services?.[service.name]?.healthcheck || "undefined";
    if (healthCheckProperty === "undefined") {
        context.warn(`Service ${service.name} is missing the healthcheck property in its docker-compose.yaml file.\n`);
        logDocumentationLink(context, "healthcheck");
    }
};

/**
* Validates the configuration of a Node.js service
* @param service - Service object.
* @param projectPath - Path to the project root directory.
* @param context - Context for logging messages.
* @returns {void}
*/
const checkNodeServiceConfig = (service: Service, projectPath: string, context) => {
    const servicePath = join(projectPath, "repositories", service.name);
    const nodemonConfigPath = join(servicePath, "nodemon.json");
    const packageJsonPath = join(servicePath, "package.json");

    const nodemonEntryFilePathSrc = join(servicePath, "src/bin/nodemon-entry.ts");
    const nodemonEntryFilePathServer = join(servicePath, "server/bin/nodemon-entry.ts");

    if (existsSync(servicePath)) {
        // Validate submodule integration labels
        validateLabelForSubmodulesIntegration(servicePath, service, context);

        // Validate package.json file
        if (existsSync(packageJsonPath)) {
            validateNodePackageJson(packageJsonPath, service.name, context);
        } else {
            logMissingFile(context, service.name, "package.json");
            return;
        }

        // Validate nodemon entry file
        if (existsSync(nodemonEntryFilePathSrc)) {
            validateNodemonEntryContent(nodemonEntryFilePathSrc, service.name, context);
        } else if (existsSync(nodemonEntryFilePathServer)) {
            validateNodemonEntryContent(nodemonEntryFilePathServer, service.name, context);
            return;
        } else {
            logMissingFile(context, service.name, "nodemon entry file in location: ./src/bin/nodemon-entry.ts or ./server/bin/nodemon-entry.ts");
        }

        // Validate nodemon.json configuration
        if (existsSync(nodemonConfigPath)) {
            validateNodemonJsonContent(projectPath, nodemonConfigPath, service.name, context);
        } else {
            logMissingFile(context, service.name, "nodemon.json");
        }
    } else {
        logMissingFile(context, service.name, "directory");
    }
};

const logMissingFile = (context, serviceName: string, fileName: string) => {
    context.error(`Service ${serviceName} is missing ${fileName}.\n`);
    logDocumentationLink(context);
};
