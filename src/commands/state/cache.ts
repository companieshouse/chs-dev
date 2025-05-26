import { Args, Command, Config, Flags } from "@oclif/core";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import yaml from "yaml";
import loadConfig from "../../helpers/config-loader.js";
import { confirm } from "../../helpers/user-input.js";
import ChsDevConfig from "../../model/Config.js";
import { StateManager } from "../../state/state-manager.js";

const EXPORT_STATE_DIR = ".exported_state_cache";
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

        if (wipe) {
            await this.handleAction("Wipe", "wipe", "Wiped all caches");
            return;
        } else if (available) {
            this.cacheActions("Available", "available");
            return;
        }

        const cacheName = args.name || this.error("Cache name is required");

        if (remove) {
            await this.handleAction(
                cacheName,
                "remove",
                `Removed cache ${cacheName}`
            );
        } else if (exportCache) {
            this.cacheActions(cacheName, "export");
        } else {
            await this.handleAction(cacheName, "add", `Saved cache as '${cacheName}'`);
        }
    }

    private async handleAction (
        cacheName: string,
        action: "add" | "remove" | "wipe",
        successMessage: string
    ): Promise<void> {
        if (await this.handlePrompt(cacheName, action)) {
            this.cacheActions(cacheName, action);
            this.log(successMessage);
        }
    }

    private cacheActions (
        cacheName: string,
        action: "add" | "remove" | "wipe" | "available" | "export"
    ): void {
        let cacheData: Record<string, any> = this.loadSavedCacheData();

        switch (action) {
        case "add": {
            const stateSnapshot = this.stateManager.snapshot;
            const dockerComposeSnapshot = this.getDockerFile();
            cacheData[cacheName] = {
                state: {
                    hash: this.hash(yaml.stringify(stateSnapshot)),
                    snapshot: stateSnapshot
                },
                dockerCompose: {
                    hash: this.hash(yaml.stringify(dockerComposeSnapshot)),
                    snapshot: dockerComposeSnapshot
                }
            };
            break;
        }
        case "remove":
            delete cacheData[cacheName];
            break;
        case "wipe":
            cacheData = {};
            break;
        case "available":
            this.availableCaches(cacheData);
            return;
        case "export": {
            this.exportCache(cacheData, cacheName);
            return;
        }
        }

        this.saveCacheData(cacheData);
    }

    private loadSavedCacheData (): Record<string, any> {
        if (existsSync(this.stateCacheFile)) {
            const fileContent = yaml.parse(
                readFileSync(this.stateCacheFile, "utf-8")
            );
            return fileContent || {};
        }
        return {};
    }

    private saveCacheData (cacheData: Record<string, any>): void {
        const lines = [
            "# DO NOT MODIFY MANUALLY",
            yaml.stringify(cacheData)
        ];

        writeFileSync(this.stateCacheFile, lines.join("\n\n"));
    }

    private availableCaches (cacheData: Record<string, any>): void {
        const cacheNames = Object.keys(cacheData);
        if (cacheNames.length > 0) {
            this.log("Available caches:");
            cacheNames.forEach((name) => this.log(`- ${name}`));
        } else {
            this.log("No cache available.");
        }
    }

    private exportCache (cacheData: Record<string, any>, cacheName: string): void {
        if (!cacheData[cacheName]) {
            this.error(`Cache named ${cacheName} does not exist.`);
        }

        const exportDir = join(this.chsDevConfig.projectPath, EXPORT_STATE_DIR);
        if (!existsSync(exportDir)) {
            mkdirSync(exportDir, { recursive: true });
        }

        const exportedFilename = join(exportDir, `${cacheName}.yaml`);

        const exportData = [
            "# DO NOT MODIFY MANUALLY",
            yaml.stringify(cacheData[cacheName])
        ];

        writeFileSync(exportedFilename, exportData.join("\n\n"));
        this.log(`Exported cache ${cacheName} destination: '${exportedFilename}'`);
    }

    private hash (data: string): string {
        const sha256Hash = createHash("sha256");
        sha256Hash.update(data);
        return sha256Hash.digest("hex");
    }

    private getDockerFile (): Buffer {
        const dockerComposeFilePath = join(
            this.chsDevConfig.projectPath,
            "docker-compose.yaml"
        );
        return yaml.parse(readFileSync(dockerComposeFilePath).toString("utf-8"));
    }

    private async handlePrompt (
        cacheName: string,
        action: "add" | "remove" | "wipe"
    ): Promise<boolean> {
        const messages: Record<string, string> = {
            add: `This will save the cache or overwrite it if it already exists. Proceed?`,
            remove: `Do you want to delete the cache named ${cacheName}?`,
            wipe: "Do you want to delete all saved caches?"
        };
        return await confirm(messages[action]);
    }
}
