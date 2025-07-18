import { Args, Command, Config, Flags } from "@oclif/core";
import { existsSync, mkdirSync } from "fs";
import { basename, join } from "path";
import loadConfig from "../../helpers/config-loader.js";
import { readFileContent } from "../../helpers/file-utils.js";
import ChsDevConfig from "../../model/Config.js";
import { StateManager } from "../../state/state-manager.js";
import { AddCacheContext, AddCacheStrategy, AvailableCacheContext, AvailableCacheStrategy, ExportCacheContext, ExportCacheStrategy, RemoveCacheContext, RemoveCacheStrategy, WipeCacheContext, WipeCacheStrategy } from "./CacheActionStrategy.js";

type CacheContextMap = {
    available: AvailableCacheContext;
    wipe: WipeCacheContext;
    remove: RemoveCacheContext;
    export: ExportCacheContext;
    add: AddCacheContext;
  };

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
            const wipeContext = this.cacheContext("wipe");
            await wipeStrategy.execute(wipeContext, cacheData);
            return;
        } else if (available) {
            const availableStrategy = new AvailableCacheStrategy();
            const availableContext = this.cacheContext("available");
            availableStrategy.execute(availableContext, cacheData);
            return;
        }

        const cacheName = args.name || this.error("Cache name is required");

        if (remove) {
            const removeStrategy = new RemoveCacheStrategy();
            const removeContext = this.cacheContext("remove");
            await removeStrategy.execute(removeContext, cacheData, cacheName);

        } else if (exportCache) {
            const exportCacheStrategy = new ExportCacheStrategy();
            const exportContext = this.cacheContext("export");
            await exportCacheStrategy.execute(exportContext, cacheData, cacheName);

        } else {
            const addCacheStrategy = new AddCacheStrategy();
            const addContext = this.cacheContext("add");
            await addCacheStrategy.execute(addContext, cacheData, cacheName);
        }
    }

    cacheContext<T extends keyof CacheContextMap> (key: T): CacheContextMap[T] {
        const logger = (msg: string) => this.log(msg);
        const map: CacheContextMap = {
            available: {
                logger
            },
            wipe: {
                stateCacheFile: this.stateCacheFile,
                logger
            },
            remove: {
                stateCacheFile: this.stateCacheFile,
                logger
            },
            export: {
                projectPath: this.chsDevConfig.projectPath,
                logger
            },
            add: {
                stateManager: this.stateManager,
                stateCacheFile: this.stateCacheFile,
                projectPath: this.chsDevConfig.projectPath,
                logger
            }
        };
        return map[key] as CacheContextMap[T];
    }

}
