import { Args, Command, Config, Flags } from "@oclif/core";
import { basename, join } from "path";
import loadConfig from "../../helpers/config-loader.js";
import ChsDevConfig from "../../model/Config.js";
import { DockerCompose } from "../../run/docker-compose.js";
import { readFileContent } from "../../helpers/file-utils.js";
import {
    handlePrompt,
    loadImportCache,
    restoreStateFiles,
    validateCacheNameExists,
    validateCacheIncludePath,
    verifyCacheAuthenticity
} from "./state-cache-utils.js";

export default class Restore extends Command {
    static description = "Restore and update the state files from saved cache or imported cache.";

    static args = {
        name: Args.string({
            required: false,
            description: "Name of the cache"
        })
    };

    static flags = {
        importCacheFrom: Flags.string({
            char: "i",
            description: "Path to the exported cache"
        })
    };

    private readonly chsDevConfig: ChsDevConfig;
    private readonly dockerCompose: DockerCompose;
    private readonly stateCacheFile: string;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();
        const cacheDir = config.cacheDir;
        this.stateCacheFile = join(cacheDir, `${basename(this.chsDevConfig.projectName)}.state.yaml`);

        const logger = { log: (msg: string) => this.log(msg) };

        this.dockerCompose = new DockerCompose(this.chsDevConfig, logger);
    }

    async run (): Promise<void> {
        const { args, flags: { importCacheFrom } } = await this.parse(Restore);

        const containerStatus = this.dockerCompose.getServiceStatuses();
        if (containerStatus !== undefined) {
            this.error("Ensure all containers are stopped. Run: '$ chs-dev down'");
        }

        if (importCacheFrom) {
            const confirmed = await handlePrompt("import-file-cache");
            if (confirmed) {
                this.restoreFromImport(importCacheFrom);
            }
        } else if (args.name && typeof args.name === "string") {
            const cacheData: Record<string, any> = readFileContent(this.stateCacheFile);
            const cacheName = args.name;

            validateCacheNameExists(cacheData, cacheName);

            const confirmed = await handlePrompt("import-saved-cache", cacheName);

            if (confirmed) {
                this.restoreFromSavedCache(cacheData, cacheName);
            }
        } else {
            this.error("Please provide a valid cache name or use the --importCacheFrom or -i flag to restore from an imported cache.");
        }

    }

    private restoreFromSavedCache (cacheData:Record<string, any>, cacheName: string): void {
        try {
            const namedCacheData = cacheData[cacheName];
            const data = verifyCacheAuthenticity(namedCacheData);
            restoreStateFiles(this.chsDevConfig, data.state, data.dockerCompose);
            this.log(`Restored state from saved cache '${cacheName}'`);
        } catch (err: any) {
            this.error(err.message);
        }
    }

    private restoreFromImport (importCachePath: string): void {
        try {
            const cacheData = loadImportCache(importCachePath);
            const verifiedData = verifyCacheAuthenticity(cacheData);
            const validatedData = validateCacheIncludePath(verifiedData, this.chsDevConfig);

            restoreStateFiles(this.chsDevConfig, validatedData.state, validatedData.dockerCompose);
            this.log(`Restored state from imported cache.`);
        } catch (err: any) {
            this.error(err.message);
        }
    }

}
