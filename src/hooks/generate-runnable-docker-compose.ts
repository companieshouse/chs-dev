import { Hook } from "@oclif/config";

import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { DockerComposeFileGenerator } from "../generator/docker-compose-file-generator.js";
import { TiltfileGenerator } from "../generator/tiltfile-generator.js";
import { ServiceLoader } from "../run/service-loader.js";

export const hook: Hook<"generate-runnable-docker-compose"> = async function (options) {
    const path = process.cwd();
    const inventory = new Inventory(path, options.config.cacheDir);
    const stateManager = new StateManager(path);
    const dockerComposeFileGenerator = new DockerComposeFileGenerator(path);
    const tiltfileGenerator = new TiltfileGenerator(path);

    const state = stateManager.snapshot;

    const serviceLoader = new ServiceLoader(inventory);

    const enabledServices = serviceLoader.loadServices(state);

    const excludedFiles = state.excludedFiles || [];

    dockerComposeFileGenerator.generateDockerComposeFile(enabledServices, excludedFiles);

    // TODO: Once dual running over remove
    tiltfileGenerator.generate(enabledServices, excludedFiles);
};

export default hook;
