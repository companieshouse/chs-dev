import { Hook } from "@oclif/core";
import { DockerComposeFileGenerator } from "../generator/docker-compose-file-generator.js";
import loadConfig from "../helpers/config-loader.js";
import { ServiceLoader } from "../run/service-loader.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

// @ts-ignore
export const hook: Hook<"generate-exclusion-docker-compose"> = async function (options) {
    const chsDevConfig = loadConfig();
    const path = chsDevConfig.projectPath;
    const stateManager = new StateManager(path);
    const state = stateManager.snapshot;

    const inventory = new Inventory(path, options.config.cacheDir);
    const serviceLoader = new ServiceLoader(inventory);
    const enabledServices = serviceLoader.loadServices(state);
    const { excludedServices } = state || [];

    const dockerComposeFileGenerator = new DockerComposeFileGenerator(path);

    try {
        dockerComposeFileGenerator.generateExclusionDockerComposeFiles(enabledServices, excludedServices);
    } catch (error) {
        console.error(error);
    }
};
