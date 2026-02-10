import { existsSync } from "fs";
import path, { join } from "path";
import yaml from "yaml";
import { readFileContent, writeContentToFile } from "../../helpers/file-utils.js";
import { hashAlgorithm } from "../../helpers/index.js";
import ChsDevConfig from "../../model/Config.js";
import { confirm } from "../../helpers/user-input.js";

export type StateCache = {
    state: {
        snapshot: Record<string, any>;
        hash: string;
    };
    dockerCompose: {
        snapshot: Record<string, any>;
        hash: string;
    };
};
type CacheActions = "add" | "remove" | "wipe" | "import-file-cache" | "import-saved-cache";

export const EXPORT_STATE_DIR = "exported_state_cache";

export const handlePrompt = async (
    action:CacheActions,
    cacheName: string = "default-cache-name"
): Promise<boolean> => {
    const messages: Record<string, string> = {
        add: `This will save the cache as '${cacheName}' or overwrite if name already exists. Proceed?`,
        remove: `Do you want to delete the cache '${cacheName}'?`,
        wipe: "Do you want to delete all saved caches?",
        "import-file-cache": "Restore from an imported file cache?",
        "import-saved-cache": `Restore from a saved cache '${cacheName}'?`
    };
    return await confirm(messages[action]);
};

export const validateNameFormat = (name: string): void => {
    const regex = /^[a-zA-Z0-9_-]+$/;
    if (!regex.test(name)) {
        throw new Error(`Invalid cache name format: '${name}'. Only alphanumeric characters with underscores or hypens are allowed.`);
    }
};

export const validateCacheNameExists = (cacheData: Record<string, any>, cacheName: string): void => {
    if (!cacheData[cacheName]) {
        throw new Error(`Cache named ${cacheName} does not exist.`);
    }
};

export function verifyCacheAuthenticity (cacheData: StateCache): StateCache {
    if (
        cacheData.state.hash === hashAlgorithm(yaml.stringify(cacheData.state.snapshot)) &&
            cacheData.dockerCompose.hash === hashAlgorithm(yaml.stringify(cacheData.dockerCompose.snapshot))
    ) {
        return cacheData;
    }
    throw new Error("Cache data has been corrupted or touched.");
}

export function loadImportCache (importCachePath: string): StateCache {
    if (!existsSync(importCachePath)) {
        throw new Error(`Import cache file does not exist in location: ${importCachePath}`);
    }
    const cacheData = readFileContent(importCachePath) as StateCache;
    if (!cacheData || typeof cacheData !== "object") {
        throw new Error(`Invalid cache data in imported file: ${importCachePath}`);
    }
    return cacheData;
}

/**
 * Validates and updates the cache include paths in the state cache to match the current project's path.
 *
 * This function checks if the cache's include paths (from `data.dockerCompose.snapshot.include`) contain the current project's name.
 * If the include paths do not match the current project's path, it remaps them to align with the host project.
 * Throws an error if the project name is not found in any of the cache include paths.
 *
 * @param data - The state cache object containing Docker Compose snapshot information.
 * @param chsDevConfig - The configuration object containing the project name and project path.
 * @returns The updated state cache object with validated and, if necessary, remapped include paths.
 * @throws {Error} If the project name is not found in the cache include paths.
 */
export function validateCacheIncludePath (data: StateCache, chsDevConfig: ChsDevConfig):StateCache {
    const { projectName, projectPath } = chsDevConfig;
    const includes = data.dockerCompose.snapshot.include || [];

    if (includes.length === 0) {
        return data;
    }

    const normalizedCacheIncludePath = path.normalize(includes[0]);
    const indexBeforeProjectName = normalizedCacheIncludePath.indexOf(projectName);

    if (indexBeforeProjectName === -1) {
        throw new Error(`${projectName} not found in cache include paths.`);
    }

    const indexAfterProjectName = indexBeforeProjectName + projectName.length;

    const cacheIncludeAbsolutePath = normalizedCacheIncludePath.slice(0, indexAfterProjectName);

    const matchesProjectPath = projectPath === cacheIncludeAbsolutePath;

    if (matchesProjectPath) {
        return data;
    }

    const updatedCacheIncludeProjectPath = remapCacheIncludePathWithProjectPath(includes, projectPath, cacheIncludeAbsolutePath);
    data.dockerCompose.snapshot.include = updatedCacheIncludeProjectPath;
    return data;
}

export function restoreStateFiles (config: ChsDevConfig, state: StateCache["state"], dockerCompose: StateCache["dockerCompose"]): void {
    const stateFilePath = join(config.projectPath, ".chs-dev.yaml");
    writeContentToFile(state.snapshot, stateFilePath);
    const dockerComposeFilePath = join(config.projectPath, "docker-compose.yaml");
    writeContentToFile(dockerCompose.snapshot, dockerComposeFilePath);
}

function remapCacheIncludePathWithProjectPath (pathList: string[], projectPath: string, cacheIncludeAbsolutePath:string): string[] {
    return pathList.map((includePath: string) => {
        return includePath.replace(
            cacheIncludeAbsolutePath, projectPath
        );
    });

}
