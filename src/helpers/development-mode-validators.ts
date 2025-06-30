import { existsSync, readFileSync } from "fs";
import { join } from "path";
import Service from "../model/Service.js";
import yaml from "yaml";
import { documentationLink } from "./link.js";

const DOCUMENTATION_LINKS = {
    node: "troubleshooting-remedies/correctly-node-services-for-development-mode.md",
    healthcheck: "troubleshooting-remedies/correctly-add-healthcheck-to-service-docker-compose.md"
};

/**
 * Validates the presence of required labels for submodule intergration or private repositories as dependencies
 * @param servicePath - Path to the local service directory.
 * @param service - Service object.
 * @param context - Context for logging messages.
 * @returns {void}
*/
export const validateLabelForSubmodulesAndPrivateRepositoriesIntegration = (servicePath:string, packageJsonPath:string, service: Service, context) => {
    const doesSubmodulesExist = checkSubmodulesDependencies(servicePath);
    const doesPrivateRepositoryDependencyExist = checkPrivateRepositoryAsDependencies(packageJsonPath);
    if (doesSubmodulesExist || doesPrivateRepositoryDependencyExist) {
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
export const validateNodemonJsonContent = (projectPath: string, actualNodemonConfigPath, serviceName: string, ext:string, context) => {
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
    const isExecInvalid = !actualConfig.exec?.includes(`/bin/nodemon-entry.${ext}`) && !actualConfig.exec?.includes("/dist");

    if (isEventsMismatch || isWatchEmpty || isExecInvalid) {
        context.warn(`Service ${serviceName} has an incorrect nodemon.json configuration.\n`);
        logDocumentationLink(context);
    }
};

/**
 * Determines if a service is a TypeScript project by checking for TypeScript dependencies or a tsconfig.json file.
 * @param servicePath - Path to the local service directory.
 * @param packageJsonPath - Path to the package.json file in the service.
 * @returns {boolean} True if the project uses TypeScript, otherwise false.
 */
export const isTypescriptProject = (servicePath: string, packageJsonPath: string): boolean => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    const hasTsConfig = existsSync(join(servicePath, "tsconfig.json"));
    const hasTypeScriptDependencies = typeof packageJson.devDependencies?.typescript === "string" ||
        typeof packageJson.dependencies?.typescript === "string";

    return hasTypeScriptDependencies || hasTsConfig;
};

export const logDocumentationLink = (context, doctype = "node") => {
    context.error(`Use as setup guide:- ${documentationLink(DOCUMENTATION_LINKS[doctype])}\n`);
};

const checkSubmodulesDependencies = (servicePath: string): boolean => {
    const gitModulesPath = join(servicePath, ".gitmodules");
    return existsSync(gitModulesPath);
};

const checkPrivateRepositoryAsDependencies = (packageJsonPath: string): boolean => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    const hasPrivateRepositoryAsDependencies = Object.values(packageJson.dependencies).some(
        (dep) => typeof dep === "string" && dep.startsWith("github:companieshouse/")
    );
    const hasPrivateRepositoryAsDevDependencies = Object.values(packageJson.devDependencies).some(
        (dep) => typeof dep === "string" && dep.startsWith("github:companieshouse/")
    );
    return hasPrivateRepositoryAsDependencies || hasPrivateRepositoryAsDevDependencies;
};
