import { Hook } from "@oclif/core";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import loadConfig from "../helpers/config-loader.js";
import Service from "../model/Service.js";

type ServicesByBuilder = { [builder: string]: Service[] };

const DOCUMENTATION_LINKS = "troubleshooting-remedies/correctly-node-services-for-development-mode.md";

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

const checkNodeServiceConfig = (service: Service, projectPath: string, context) => {
    const servicePath = join(projectPath, "repositories", service.name);
    const nodemonConfigPath = join(servicePath, "nodemon.json");
    const packageJsonPath = join(servicePath, "package.json");

    const nodemonEntryFilePathSrc = join(servicePath, "src/bin/nodemon-entry.ts");
    const nodemonEntryFilePathServer = join(servicePath, "server/bin/nodemon-entry.ts");

    if (existsSync(servicePath)) {
        validateLabelForSubmodulesIntegration(servicePath, service, context);

        if (existsSync(packageJsonPath)) {
            validatePackageJson(packageJsonPath, service.name, context);
        } else {
            logMissingFile(context, service.name, "package.json");
            return;
        }

        if (existsSync(nodemonEntryFilePathSrc)) {
            validateNodemonEntryContent(nodemonEntryFilePathSrc, service.name, context);
        } else if (existsSync(nodemonEntryFilePathServer)) {
            validateNodemonEntryContent(nodemonEntryFilePathServer, service.name, context);
            return;
        } else {
            logMissingFile(context, service.name, "nodemon entry file in location: ./src/bin/nodemon-entry.ts or ./server/bin/nodemon-entry.ts");
        }

        if (existsSync(nodemonConfigPath)) {
            validateNodemonJsonContent(projectPath, nodemonConfigPath, service.name, context);

        } else {
            logMissingFile(context, service.name, "nodemon.json");
        }

    } else {
        logMissingFile(context, service.name, "directory");
    }

};

const validateLabelForSubmodulesIntegration = (servicePath, service: Service, context) => {
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

const validatePackageJson = (packageJsonPath: any, serviceName: string, context) => {
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

const validateNodemonEntryContent = (actualNodemonEntryPath, serviceName: string, context) => {
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

const validateNodemonJsonContent = (projectPath: string, actualNodemonConfigPath, serviceName: string, context) => {
    const expectedConfigPath = join(projectPath, "local/builders/node/v3/bin/config/nodemon.json");

    if (!existsSync(expectedConfigPath)) {
        context.warn(`Expected nodemon configuration file is missing at ${expectedConfigPath}.\n`);
        logDocumentationLink(context);
        return;
    }

    const expectedConfig = JSON.parse(readFileSync(expectedConfigPath, "utf-8"));
    const actualConfig = JSON.parse(readFileSync(actualNodemonConfigPath, "utf-8"));

    if (JSON.stringify(expectedConfig.events) !== JSON.stringify(actualConfig.events) ||
        !JSON.stringify(actualConfig.exec).includes("/bin/nodemon-entry.ts") ||
        actualConfig.watch.length === 0) {
        context.warn(`Service ${serviceName} has an incorrect nodemon.json configuration.\n`);
        logDocumentationLink(context);
    }
};

const logMissingFile = (context, serviceName: string, fileName: string) => {
    context.error(`Service ${serviceName} is missing ${fileName}.\n`);
    logDocumentationLink(context);
};

const logDocumentationLink = (context) => {
    context.error(`Use as setup guide:- ${documentationLink(DOCUMENTATION_LINKS)}`);
};

const documentationLink = (documentationFileName: string) => {
    return `https://www.github.com/companieshouse/chs-dev/blob/main/docs/${documentationFileName}`;
};
