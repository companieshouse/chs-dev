import yaml from "yaml";

import { getGeneratedDockerComposeFile } from "../../helpers/docker-compose-file.js";
import { hashAlgorithm } from "../../helpers/index.js";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { writeContentToFile } from "../../helpers/file-utils.js";
import { handlePrompt, validateCacheNameExists } from "./state-cache-utils.js";
import { StateManager } from "../../state/state-manager.js";

const EXPORT_STATE_DIR = ".exported_state_cache";

export interface AvailableCacheContext {
    logger: (message: string) => void;
  }

export interface WipeCacheContext {
    stateCacheFile: string;
    logger: (message: string) => void;
}

export interface RemoveCacheContext {
    stateCacheFile: string;
    logger: (message: string) => void;
}

export interface ExportCacheContext {
    projectPath: string;
    logger: (message: string) => void;
}

export interface AddCacheContext {
    stateManager: StateManager;
    stateCacheFile: string;
    projectPath: string;
    logger: (message: string) => void;
}
interface CacheActionStrategy<C> {
    execute(cache: C, cacheData: Record<string, any>, cacheName?: string): Promise<void> | void;
}

const handleExportCache = (context: ExportCacheContext, cacheData: Record<string, any>, cacheName: string): void => {
    const exportDir = join(context.projectPath, EXPORT_STATE_DIR);
    if (!existsSync(exportDir)) {
        mkdirSync(exportDir, { recursive: true });
    }

    const exportedFilenamePath = join(exportDir, `${cacheName}.yaml`);

    writeContentToFile(cacheData[cacheName], exportedFilenamePath);
    context.logger(`Exported cache ${cacheName} destination: '${exportedFilenamePath}'`);
};

export class AvailableCacheStrategy implements CacheActionStrategy<AvailableCacheContext> {
    execute (context: AvailableCacheContext, cacheData: Record<string, any>): void {
        const cacheNames = Object.keys(cacheData);
        if (cacheNames.length > 0) {
            context.logger("Available caches:");
            cacheNames.forEach((name: string) => context.logger(`- ${name}`));
        } else {
            context.logger("No cache available.");
        }
    }
}

export class WipeCacheStrategy implements CacheActionStrategy<WipeCacheContext> {
    async execute (context: WipeCacheContext, _cacheData: Record<string, any>): Promise<void> {
        const confirmed = await handlePrompt("wipe");
        if (confirmed) {
            writeContentToFile({}, context.stateCacheFile);
            context.logger("Wiped all caches");
        }
    }
}

export class RemoveCacheStrategy implements CacheActionStrategy<RemoveCacheContext> {
    async execute (context: RemoveCacheContext, _cacheData: Record<string, any>, _cacheName: string): Promise<void> {
        validateCacheNameExists(_cacheData, _cacheName);

        const confirmed = await handlePrompt("remove", _cacheName);
        if (confirmed) {
            delete _cacheData[_cacheName];
            writeContentToFile(_cacheData, context.stateCacheFile);
            context.logger(`Removed cache '${_cacheName}'`);

        }
    }
}

export class ExportCacheStrategy implements CacheActionStrategy<ExportCacheContext> {
    async execute (context: ExportCacheContext, _cacheData: Record<string, any>, _cacheName: string): Promise<void> {
        validateCacheNameExists(_cacheData, _cacheName);
        handleExportCache(context, _cacheData, _cacheName);

    }
}

export class AddCacheStrategy implements CacheActionStrategy<AddCacheContext> {
    async execute (context: AddCacheContext, _cacheData: Record<string, any>, _cacheName: string): Promise<void> {
        const confirmed = await handlePrompt("add", _cacheName);
        if (confirmed) {
            const stateSnapshot = context.stateManager.snapshot;
            const dockerComposeSnapshot = getGeneratedDockerComposeFile(context.projectPath);
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
            writeContentToFile(_cacheData, context.stateCacheFile);
            context.logger(`Saved cache as '${_cacheName}'`);
        }
    }
}
