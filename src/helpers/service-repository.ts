import { basename, join } from "path";
import CONSTANTS from "../model/Constants.js";
import Service from "../model/Service.js";

/**
 * Name of the repository (and so of its folder under repositories/) which
 * holds the code for the service, taken from its repository url. More
 * services can share one repo
 * (ex. eric / eric-web / eric-stream, all sharing github.com:companieshouse/eric.git).
 * Falls back to the service name.
 */
export const repositoryName = (service: Pick<Service, "name" | "repository">): string => {
    const url = service.repository?.url?.trim().replace(/\/+$/, "");
    const name = url ? basename(url.replace(/:/g, "/")).replace(/\.git$/, "") : "";

    return name || service.name;
};

/**
 * Path, relative to the project, of the env file provided by the repository
 * of the service
 */
export const serviceEnvFilePath = (service: Pick<Service, "name" | "repository">): string =>
    join("repositories", repositoryName(service), CONSTANTS.SERVICE_ENV_FILE);
