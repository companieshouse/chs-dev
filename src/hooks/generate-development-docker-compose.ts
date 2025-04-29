import { IConfig } from "@oclif/config";
import { Hook } from "@oclif/core";
import { DockerComposeFileGenerator } from "../generator/docker-compose-file-generator.js";
import loadConfig from "../helpers/config-loader.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

// @ts-ignore
export const hook: Hook<"generate-development-docker-compose"> = async function ({ serviceName, builderVersion, config, context }: { serviceName: string; builderVersion?: string; config: IConfig }) {
    const chsDevConfig = loadConfig();
    const path = chsDevConfig.projectPath;
    const inventory = new Inventory(path, config.cacheDir);
    const dockerComposeFileGenerator = new DockerComposeFileGenerator(path);
    const service = inventory.services.find(service => service.name === serviceName && !service.source.includes("tilt/"));

    const stateManager = new StateManager(path);
    const state = stateManager.snapshot;
    const { excludedServices } = state || [];

    if (typeof service === "undefined") {
        return this.error(`Cannot create development compose file for the service: ${serviceName} since it does not exist.`);
    }

    if (!service.builder) {
        context.warn(`Ignore this message if this service is not a Node or Java service.`);
        context.warn(`${serviceName}: Builder not found.`);
        context.warn(`Run: 'bin/migration/set_builder_label ${serviceName}' in the root directory`);
    }

    try {
        dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service, builderVersion, excludedServices);
    } catch (error) {
        console.error(error);
    }
};
