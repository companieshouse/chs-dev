import { Args, Command, Config, Flags } from "@oclif/core";
import { existsSync, mkdirSync } from "fs";
import { basename, join } from "path";
import loadConfig from "../../helpers/config-loader.js";
import { readFileContent } from "../../helpers/file-utils.js";
import ChsDevConfig from "../../model/Config.js";
import { StateManager } from "../../state/state-manager.js";
import { AddCacheStrategy, AvailableCacheStrategy, ExportCacheStrategy, RemoveCacheStrategy, WipeCacheStrategy } from "./CacheActionStrategy.js";

export default class Cache extends Command {
    static description = "Cache the state of chs-dev into a saved file";

    static args = {
        name: Args.string({
            required: false,
            description: "Name of the cache"
        })
    };

    static flags = {
        wipe: Flags.boolean({
            char: "w",
            description: "Delete all saved caches"
        }),
        remove: Flags.boolean({
            char: "r",
            description: "Remove a specific saved cache"
        }),
        available: Flags.boolean({
            char: "a",
            description: "List of saved states."
        }),
        exportCache: Flags.boolean({
            char: "e",
            description: "Export a named cache to a file"
        })
    };

    private readonly stateManager: StateManager;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly stateCacheFile: string;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();
        const cacheDir = config.cacheDir;
        this.stateCacheFile = join(
            cacheDir,
            `${basename(this.chsDevConfig.projectName)}.state.yaml`
        );

        if (!existsSync(cacheDir)) {
            mkdirSync(cacheDir, { recursive: true });
        }

        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
    }

    async run (): Promise<void> {
        const {
            args,
            flags: { available, remove, wipe, exportCache }
        } = await this.parse(Cache);

        const cacheData: Record<string, any> = readFileContent(this.stateCacheFile);

        if (wipe) {
            const wipeStrategy = new WipeCacheStrategy();
            await wipeStrategy.execute(this, cacheData);
            return;
        } else if (available) {
            const availableStrategy = new AvailableCacheStrategy();
            availableStrategy.execute(this, cacheData);
            return;
        }

        const cacheName = args.name || this.error("Cache name is required");

        if (remove) {
            const removeStrategy = new RemoveCacheStrategy();
            await removeStrategy.execute(this, cacheData, cacheName);

        } else if (exportCache) {
            const exportCacheStrategy = new ExportCacheStrategy();
            await exportCacheStrategy.execute(this, cacheData, cacheName);

        } else {
            const addCacheStrategy = new AddCacheStrategy();
            await addCacheStrategy.execute(this, cacheData, cacheName);
        }
    }

}
