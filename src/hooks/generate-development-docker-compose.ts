import { Hook } from "@oclif/core";
import { join } from "path";
import { Inventory } from "../state/inventory.js";
import { DockerComposeFileGenerator } from "../generator/docker-compose-file-generator.js";
import { IConfig } from "@oclif/config";
import loadConfig from "../helpers/config-loader.js";

// @ts-ignore
export const hook: Hook<"generate-development-docker-compose"> = async function ({ serviceName, builderVersion, config }: { serviceName: string; builderVersion?: string; config: IConfig }) {
    const chsDevConfig = loadConfig();
    const path = chsDevConfig.projectPath;
    const inventory = new Inventory(path, config.cacheDir);
    const dockerComposeFileGenerator = new DockerComposeFileGenerator(path);
    const service = inventory.services.find(service => service.name === serviceName && !service.source.includes("tilt/"));

    if (typeof service === "undefined") {
        return this.error("Cannot create development compose file for a service that does not exist.");
    }

    try {
        dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service, builderVersion);
    } catch (error) {
        console.error(error);
    }
};
