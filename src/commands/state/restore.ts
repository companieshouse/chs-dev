import { Args, Command, Config, Flags } from "@oclif/core";
import ChsDevConfig from "../../model/Config.js";
import loadConfig from "../../helpers/config-loader.js";
import { DockerCompose } from "../../run/docker-compose.js";
import { confirm } from "../../helpers/user-input.js";
import { createHash } from "crypto";
import yaml from "yaml";
import { basename, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

type StateCache = {
    state: {
        snapshot: Record<string, any>;
        hash: string
    }
    dockerCompose: {
        snapshot: Record<string, any>;
        hash: string;
    }
};

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

        const cacheName = importCacheFrom ? "import-cache" : args.name;

        if (!cacheName || typeof cacheName === "undefined") {
            this.error("Please provide a valid cache name or use the --importCacheFrom or -i flag to restore from an imported cache.");
        }
        console.log(`Restoring state from cache: ${cacheName}`);
        if (importCacheFrom) {
            if (await this.handlePrompt(cacheName)) {
                this.restoreFromImport(importCacheFrom);
            }
        } else {
            if (await this.handlePrompt(cacheName)) {
                this.restoreFromSavedCache(cacheName);
            }
        }

    }

    private restoreFromSavedCache (cacheName: string): void {
        const cacheData = this.loadSavedCacheData();
        const namedCacheData = cacheData[cacheName];
        if (!namedCacheData) {
            this.error(`Cache with name '${cacheName}' not found.`);
        }
        const data = this.verifyCacheAuthencity(namedCacheData, (stateCache) => stateCache);

        this.restoreState(data);
        this.log(`Restored state from saved cache '${cacheName}'`);
    }

    private restoreFromImport (importCache: string): void {
        if (!existsSync(importCache)) {
            this.error(`Import cache file does not exist in location: ${importCache}`);
        }

        const cacheData = this.parseYamlFile(importCache) as StateCache;

        if (!cacheData || typeof cacheData !== "object") {
            this.error(`Invalid cache data in imported file: ${importCache}`);
        }

        const data = this.verifyCacheAuthencity(cacheData, (stateCache) => stateCache);

        this.restoreState(data);
        this.log(`Restored state from imported cache.`);
    }

    private verifyCacheAuthencity<T> (cacheData: StateCache, cacheSupplier: (stateCache: StateCache) => StateCache): StateCache {

        if (cacheData.state.hash === this.hash(yaml.stringify(cacheData.state.snapshot)) &&
            cacheData.dockerCompose.hash === this.hash(yaml.stringify(cacheData.dockerCompose.snapshot))) {
            return cacheSupplier(cacheData);
        }
        this.error("Cache data has been corrupted or touched.");
    }

    private restoreState ({ state, dockerCompose }: StateCache): void {
        // Restore state file
        const stateFilePath = join(this.chsDevConfig.projectPath, `.chs-dev.yaml`);
        const stateData = [
            "# DO NOT MODIFY MANUALLY",
            yaml.stringify(state.snapshot)
        ];
        writeFileSync(stateFilePath, stateData.join("\n\n"));

        // Restore docker-compose file
        const dockerComposeFilePath = join(this.chsDevConfig.projectPath, "docker-compose.yaml");
        const dockerComposeData = [
            "# DO NOT MODIFY MANUALLY",
            yaml.stringify(dockerCompose.snapshot)
        ];
        writeFileSync(dockerComposeFilePath, dockerComposeData.join("\n\n"));
    }

    private loadSavedCacheData (): Record<string, StateCache> {
        if (existsSync(this.stateCacheFile)) {
            return this.parseYamlFile(this.stateCacheFile) as Record<string, StateCache> || {};
        }
        return {};
    }

    private parseYamlFile (filePath: string): Record<string, StateCache> | StateCache {
        return yaml.parse(readFileSync(filePath, "utf-8"));
    }

    private hash (data: string): string {
        return createHash("sha256").update(data).digest("hex");
    }

    private async handlePrompt (cacheName: string): Promise<boolean> {
        const message = cacheName === "import-cache"
            ? `Restore from an imported cache?`
            : `Restore from a saved cache '${cacheName}'?`;
        return confirm(message);
    }
}
