import { Hook } from "@oclif/core";
import { existsSync } from "fs";
import { join } from "path";
import loadConfig from "../helpers/config-loader.js";
import {
    logDocumentationLink,
    validateLabelForSubmodulesIntegration,
    validateNodemonEntryContent,
    validateNodemonJsonContent,
    validateNodePackageJson
} from "../helpers/development-mode-validators.js";
import Service from "../model/Service.js";

type ServicesByBuilder = { [builder: string]: Service[] };

// @ts-ignore
export const hook: Hook<"check-development-service-config"> = async ({ servicesByBuilder, context }: { servicesByBuilder: ServicesByBuilder }) => {
    const projectPath = loadConfig().projectPath;

    for (const [builder, services] of Object.entries(servicesByBuilder)) {
        if (builder === "node") {
            for (const service of services) {
                checkNodeServiceConfig(service, projectPath, context);
            }
        }
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
