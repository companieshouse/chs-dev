import { Hook } from "@oclif/config";

import { join } from "path";

import { Inventory, Service } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { DockerComposeFileGenerator } from "../generator/docker-compose-file-generator.js";
import { TiltfileGenerator } from "../generator/tiltfile-generator.js";

export const hook: Hook<"generate-runnable-docker-compose"> = async function (options) {
    const path = process.cwd();
    const inventory = new Inventory(path, options.config.configDir);
    const stateManager = new StateManager(path);
    const dockerComposeFileGenerator = new DockerComposeFileGenerator(path);
    const tiltfileGenerator = new TiltfileGenerator(path);

    const state = stateManager.snapshot;

    const allServices = inventory.services;

    // Converts a list of service names to a list of services
    const dependentServices = (dependencyNames: string[]) => dependencyNames.map(dependency => allServices
        .find(potentialService => potentialService.name === dependency)).filter(dependency => typeof dependency !== "undefined");

    // Loads a list of services which are enabled
    const enabledServices = allServices
        .filter(service => state.modules.includes(service.module) || state.services.includes(service.name))
        .flatMap(service => {
            return [
                service,
                ...dependentServices(service.dependsOn)
            ]
                .filter(dependency => typeof dependency !== "undefined");
        })
        .reduce((services: Service[], current: Service | undefined) => {
            if (typeof current === "undefined") {
                return services;
            }

            // Deduplicate list only adding new services to the resulting list
            const existsAlready = services.some(
                service => service.name === current.name
            );

            if (!existsAlready) {
                services.push(current);
            }

            return services;
        }, [])
        .map(
            service => (
                {
                    ...service,
                    liveUpdate: state.servicesWithLiveUpdate.includes(service.name)
                }
            )
        );

    const excludedFiles = state.excludedFiles || [];

    dockerComposeFileGenerator.generateDockerComposeFile(enabledServices, excludedFiles);

    // TODO: Once dual running over remove
    tiltfileGenerator.generate(enabledServices, excludedFiles);
};

export default hook;
