import { existsSync, readFileSync } from "fs";
import { join } from "path";
import Service from "../model/Service.js";
import yaml from "yaml";

const DOCUMENTATION_LINKS = {
    node: "troubleshooting-remedies/correctly-node-services-for-development-mode.md",
    healthcheck: "troubleshooting-remedies/correctly-add-healthcheck-to-service-docker-compose.md"
};

const documentationLink = (documentationFileName: string) => {
    return `https://www.github.com/companieshouse/chs-dev/blob/main/docs/${documentationFileName}`;
};
/**
 * Validates the presence of required labels for submodule integration
 * @param servicePath - Path to the local service directory.
 * @param service - Service object.
 * @param context - Context for logging messages.
 * @returns {void}
*/
export const validateLabelForSubmodulesIntegration = (servicePath, service: Service, context) => {
    const gitModulesPath = join(servicePath, ".gitmodules");
    if (existsSync(gitModulesPath)) {
        const dockerCompose = yaml.parse(readFileSync(service.source, "utf-8"));
        const serviceConfig = dockerCompose.services?.[service.name];
        const requiresSecretsLabel = serviceConfig?.labels?.find(label => label.startsWith("chs.local.builder.requiresSecrets"));

        if (requiresSecretsLabel !== "chs.local.builder.requiresSecrets=true") {
            context.warn(`Service ${service.name} is missing the label "chs.local.builder.requiresSecrets=true" in its docker-compose configuration as it depends on a submodule.\n`);
            logDocumentationLink(context);
        }
    }
};

/**
 * Validates the package.json file for required scripts and dependencies
 * @param packageJsonPath - Path to the package.json file in the service.
 * @param serviceName - Service name.
 * @param context - Context for logging messages.
 * @returns {void}
*/
export const validateNodePackageJson = (packageJsonPath: any, serviceName: string, context) => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    const hasChsDevScript = packageJson.scripts?.["chs-dev"] === "nodemon --legacy-watch";
    const hasNodemonInstalled = !!packageJson.devDependencies?.nodemon;
    if (!hasChsDevScript) {
        context.warn(`Service ${serviceName} is missing the "chs-dev" script or has incorrect value in package.json.\n`);
        logDocumentationLink(context);
    }

    if (!hasNodemonInstalled) {
        context.warn(`Service ${serviceName} is missing the nodemon package in its devDependencies.\n`);
        logDocumentationLink(context);
    }
};

/**
 * Validates the content of the nodemon entry file
 * @param actualNodemonEntryPath - Path to the nodemon-entry.ts file in the service.
 * @param serviceName - Service name.
 * @param context - Context for logging messages.
 * @returns {void}
*/
export const validateNodemonEntryContent = (actualNodemonEntryPath, serviceName: string, context) => {
    const actualFileContent = readFileSync(actualNodemonEntryPath, "utf-8");

    const listenRegex = /\.listen\s*\(\s*PORT\s*,\s*\(\s*\)\s*=>\s*(\{[\s\S]*?\}|[^\n;]*?)\)/;
    const logLineRegex = /console\.log\s*\(\s*`✅\s+Application Ready\. Running on port \$\{PORT\}`\s*\)\s*;?/;

    const hasListen = listenRegex.test(actualFileContent);
    const hasLog = logLineRegex.test(actualFileContent);

    if (!hasListen || !hasLog) {
        context.warn(`Service ${serviceName} nodemon entry file: '${actualNodemonEntryPath}' is missing the required listen event or log line.\n`);
        logDocumentationLink(context);
    }
};

/**
 * Validates the content of the nodemon.json configuration file
 * @param projectPath - Project root path.
 * @param actualNodemonConfigPath - Path to the actual nodemon.json file in the service.
 * @param serviceName - Service name.
 * @param context - Context for logging messages.
 * @returns {void}
*/
export const validateNodemonJsonContent = (projectPath: string, actualNodemonConfigPath, serviceName: string, context) => {
    const expectedConfigPath = join(projectPath, "local/builders/node/v3/bin/config/nodemon.json");

    if (!existsSync(expectedConfigPath)) {
        context.warn(`Expected nodemon configuration file is missing at ${expectedConfigPath}.\n`);
        logDocumentationLink(context);
        return;
    }

    const expectedConfig = JSON.parse(readFileSync(expectedConfigPath, "utf-8"));
    const actualConfig = JSON.parse(readFileSync(actualNodemonConfigPath, "utf-8"));

    const isEventsMismatch = JSON.stringify(expectedConfig.events) !== JSON.stringify(actualConfig.events);
    const isWatchEmpty = actualConfig.watch.length === 0;
    const isExecInvalid = !actualConfig.exec?.includes("/bin/nodemon-entry.ts") && !actualConfig.exec?.includes("/dist");

    if (isEventsMismatch || isWatchEmpty || isExecInvalid) {
        context.warn(`Service ${serviceName} has an incorrect nodemon.json configuration.\n`);
        logDocumentationLink(context);
    }
};

export const logDocumentationLink = (context, doctype = "node") => {
    context.error(`Use as setup guide:- ${documentationLink(DOCUMENTATION_LINKS[doctype])}\n`);
};
