import { Hook } from "@oclif/core";
import { join } from "path";
import { Inventory } from "../state/inventory.js";
import { DockerComposeFileGenerator } from "../generator/docker-compose-file-generator.js";
import { IConfig } from "@oclif/config";

// @ts-ignore
export const hook: Hook<"generate-development-docker-compose"> = async function ({ serviceName, config }: { serviceName: string; config: IConfig }) {
    const path = process.cwd();
    const inventory = new Inventory(path, config.configDir);
    const dockerComposeFileGenerator = new DockerComposeFileGenerator(path);
    const service = inventory.services.find(service => service.name === serviceName);

    if (typeof service === "undefined") {
        return this.error("Cannot create development compose file for a service that does not exist.");
    }

    dockerComposeFileGenerator.generateDevelopmentServiceDockerComposeFile(service);
};
