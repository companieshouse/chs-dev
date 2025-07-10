import yaml from "yaml";
import { confirm } from "../../helpers/user-input.js";
import { getGeneratedDockerComposeFile } from "../../helpers/docker-compose-file.js";
import { hashAlgorithm } from "../../helpers/index.js";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { writeContentToFile } from "../../helpers/file-utils.js";
import Cache from "./cache.js";

interface CacheActionStrategy {
    execute(cache: Cache, cacheData: Record<string, any>, cacheName?: string): Promise<void> | void;
}

const EXPORT_STATE_DIR = ".exported_state_cache";

const handlePrompt = async (
    action: "add" | "remove" | "wipe",
    cacheName: string = "default-cache-name"
): Promise<boolean> => {
    const messages: Record<string, string> = {
        add: `This will save the cache as '${cacheName}' or overwrite if name already exists. Proceed?`,
        remove: `Do you want to delete the cache '${cacheName}'?`,
        wipe: "Do you want to delete all saved caches?"
    };
    return await confirm(messages[action]);
};

const validateCacheNameExists = (cache: Cache, cacheData: Record<string, any>, cacheName: string): void => {
    if (!cacheData[cacheName]) {
        cache.error(`Cache named ${cacheName} does not exist.`);
    }
};

const handleExportCache = (cache: Cache, cacheData: Record<string, any>, cacheName: string): void => {
    const exportDir = join((cache as any).chsDevConfig.projectPath, EXPORT_STATE_DIR);
    if (!existsSync(exportDir)) {
        mkdirSync(exportDir, { recursive: true });
    }

    const exportedFilenamePath = join(exportDir, `${cacheName}.yaml`);

    writeContentToFile(cacheData[cacheName], exportedFilenamePath);
    cache.log(`Exported cache ${cacheName} destination: '${exportedFilenamePath}'`);
};

export class AvailableCacheStrategy implements CacheActionStrategy {
    execute (cache: Cache, cacheData: Record<string, any>): void {
        const cacheNames = Object.keys(cacheData);
        if (cacheNames.length > 0) {
            cache.log("Available caches:");
            cacheNames.forEach((name: string) => cache.log(`- ${name}`));
        } else {
            cache.log("No cache available.");
        }
    }
}

export class WipeCacheStrategy implements CacheActionStrategy {
    async execute (cache: Cache, _cacheData: Record<string, any>): Promise<void> {
        const confirmed = await handlePrompt("wipe");
        if (confirmed) {
            writeContentToFile({}, (cache as any).stateCacheFile);
            cache.log("Wiped all caches");
        }
    }
}

export class RemoveCacheStrategy implements CacheActionStrategy {
    async execute (cache: Cache, _cacheData: Record<string, any>, _cacheName: string): Promise<void> {

        validateCacheNameExists(cache, _cacheData, _cacheName);
        const confirmed = await handlePrompt("remove", _cacheName);

        if (confirmed) {
            delete _cacheData[_cacheName];
            writeContentToFile(_cacheData, (cache as any).stateCacheFile);
            cache.log(`Removed cache '${_cacheName}'`);

        }
    }
}

export class ExportCacheStrategy implements CacheActionStrategy {
    async execute (cache: Cache, _cacheData: Record<string, any>, _cacheName: string): Promise<void> {
        validateCacheNameExists(cache, _cacheData, _cacheName);

        handleExportCache(cache, _cacheData, _cacheName);

    }
}

export class AddCacheStrategy implements CacheActionStrategy {
    async execute (cache: Cache, _cacheData: Record<string, any>, _cacheName: string): Promise<void> {
        const confirmed = await handlePrompt("add", _cacheName);
        if (confirmed) {
            const stateSnapshot = (cache as any).stateManager.snapshot;
            const dockerComposeSnapshot = getGeneratedDockerComposeFile((cache as any).chsDevConfig.projectPath);
            _cacheData[_cacheName] = {
                state: {
                    hash: hashAlgorithm(yaml.stringify(stateSnapshot)),
                    snapshot: stateSnapshot
                },
                dockerCompose: {
                    hash: hashAlgorithm(yaml.stringify(dockerComposeSnapshot)),
                    snapshot: dockerComposeSnapshot
                }
            };
            writeContentToFile(_cacheData, (cache as any).stateCacheFile);
            cache.log(`Saved cache as '${_cacheName}'`);
        }
    }
}
