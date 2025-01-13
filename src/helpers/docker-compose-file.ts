import { readFileSync, readdirSync, lstatSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import CONSTANTS from "../model/Constants.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";

export const getInitialDockerComposeFile = (path: string): DockerComposeSpec => {
    return yaml.parse(
        readFileSync(join(path, CONSTANTS.BASE_DOCKER_COMPOSE_FILE), "utf8").toString()
    );
};

export const isFile: (fileName:string) => boolean = fileName => {
    return lstatSync(fileName).isFile();
};

export const getAllFilesInDirectory = (dirPath: string): string[] => {
    return readdirSync(dirPath).map(fileName => {
        return join(dirPath, fileName);
    }).filter(isFile);

};
