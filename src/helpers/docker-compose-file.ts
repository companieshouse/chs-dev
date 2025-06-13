import { readFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import CONSTANTS from "../model/Constants.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";

/**
 * Get the initial compose file by path
 *
 * @param path - default compose file path location
 * @returns a yaml format of the compose file
 */
export const getInitialDockerComposeFile = (path: string): DockerComposeSpec => {
    return yaml.parse(
        readFileSync(join(path, CONSTANTS.BASE_DOCKER_COMPOSE_FILE), "utf8").toString()
    );
};

/**
 * Get the generated main compose file content
 *
 * @param path - default compose file path location
 * @returns a yaml format of the compose file
 */
export const getGeneratedDockerComposeFile = (path: string): DockerComposeSpec => {
    const generatedDockerComposePath = join(path, `docker-compose.yaml`);
    return yaml.parse(
        readFileSync(generatedDockerComposePath, "utf8").toString()
    );
};
