import { Hook, IConfig } from "@oclif/config";

import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { DockerComposeFileGenerator } from "../generator/docker-compose-file-generator.js";
import { ServiceLoader } from "../run/service-loader.js";
import loadConfig from "../helpers/config-loader.js";

type ExtendedHookOptions = {
    generateExclusionSpec?: boolean
}

type HookOptions = ExtendedHookOptions & { config: IConfig }

export const hook: Hook<["generate-runnable-docker-compose"]> = async function (
    { config, generateExclusionSpec }: HookOptions
) {
    const chsDevConfig = loadConfig();
    const path = chsDevConfig.projectPath;
    const inventory = new Inventory(path, config.cacheDir);
    const stateManager = new StateManager(path);
    const dockerComposeFileGenerator = new DockerComposeFileGenerator(path);

    const state = stateManager.snapshot;

    const serviceLoader = new ServiceLoader(inventory);

    const enabledServices = serviceLoader.loadServices(state);
    const { excludedServices } = state || [];

    if (generateExclusionSpec) {
        dockerComposeFileGenerator.generateExclusionDockerComposeFiles(enabledServices, excludedServices);
    } else {
        dockerComposeFileGenerator.generateDockerComposeFile(enabledServices);
    }

};

export default hook;
