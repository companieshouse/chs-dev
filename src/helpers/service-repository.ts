import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
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

export const MISSING_REPOSITORY = "missing";

/**
 * Branch checked out in the given repository folder: "missing" when the
 * folder does not exist, "unknown" when it is not a readable git repository
 * ("HEAD" when detached).
 */
export const currentBranch = (repositoryPath: string): string => {
    if (!existsSync(repositoryPath)) {
        return MISSING_REPOSITORY;
    }

    try {
        return execFileSync(
            "git", ["-C", repositoryPath, "rev-parse", "--abbrev-ref", "HEAD"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim() || "unknown";
    } catch {
        return "unknown";
    }
};

/**
 * Latest release tag (x.y.z) reachable from HEAD in the given repository
 * folder, or undefined when the folder is missing, is not a git repository
 * or has no such tag.
 */
export const latestReleaseTag = (repositoryPath: string): string | undefined => {
    if (!existsSync(join(repositoryPath, ".git"))) {
        return undefined;
    }

    try {
        return execFileSync(
            "git", ["describe", "--tags", "--abbrev=0", "--match", "[0-9]*.[0-9]*.[0-9]*"],
            { cwd: repositoryPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim() || undefined;
    } catch {
        return undefined;
    }
};

/**
 * Path, relative to the project, of the generated env file defining the TAG
 * of the images of the services using the repository
 */
export const tagEnvFilePath = (service: Pick<Service, "name" | "repository">): string =>
    join(CONSTANTS.ENV_OVERRIDES_DIRECTORY, `${repositoryName(service)}.tag.env`);

/**
 * TAG defined in the generated env file of the service, undefined when the
 * file does not exist (so docker compose falls back to latest).
 */
export const tagInUse = (projectPath: string, service: Pick<Service, "name" | "repository">): string | undefined => {
    try {
        return /^TAG=(.+)$/m.exec(readFileSync(join(projectPath, tagEnvFilePath(service)), "utf8"))?.[1].trim();
    } catch {
        return undefined;
    }
};

/**
 * Services of the infrastructure module (redis, mongo, kafka...) have no
 * repository, so they never need one cloned.
 */
export const requiresRepository = (service: Pick<Service, "module">): boolean =>
    service.module !== "infrastructure";

/**
 * Finds the repositories, which are not cloned under repositories/, of the
 * given services: repository name -> names of the services using it.
 */
export const findMissingRepositories = (
    projectPath: string, services: Pick<Service, "name" | "module" | "repository">[]
): Record<string, string[]> =>
    services.filter(requiresRepository).reduce((missing, service) => {
        const repository = repositoryName(service);

        if (!existsSync(join(projectPath, "repositories", repository))) {
            missing[repository] = [...(missing[repository] ?? []), service.name];
        }
        return missing;
    }, {} as Record<string, string[]>);
