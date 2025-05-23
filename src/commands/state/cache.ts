import { Args, Command, Config, Flags } from "@oclif/core";
import { StateManager } from "../../state/state-manager.js";
import ChsDevConfig from "../../model/Config.js";
import loadConfig from "../../helpers/config-loader.js";
import { DockerCompose } from "../../run/docker-compose.js";
import { confirm } from "../../helpers/user-input.js";
import { createHash } from "crypto";
import yaml from "yaml";
import { basename, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

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
            description: "Show the name of the saved states in a available"
        })
    };

    private readonly stateManager: StateManager;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly dockerCompose: DockerCompose;
    private readonly stateCacheFile: string;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();
        const cacheDir = config.cacheDir;
        this.stateCacheFile = join(cacheDir, `${basename(this.chsDevConfig.projectName)}.state.yaml`);

        if (!existsSync(cacheDir)) {
            mkdirSync(cacheDir, { recursive: true });
        }

        const logger = { log: (msg: string) => this.log(msg) };

        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.dockerCompose = new DockerCompose(this.chsDevConfig, logger);
    }

    async run (): Promise<void> {
        const { args, flags: { available, remove, wipe } } = await this.parse(Cache);

        if (wipe) {
            await this.handleAction("Wipe", "wipe", "Wiped all caches");
            return;
        } else if (available) {
            this.cacheActions("Available", "available");
            return;
        }

        const cacheName = args.name || this.error("Cache name is required");

        if (remove) {
            await this.handleAction(cacheName, "remove", `Removed cache ${cacheName}`);
        } else {
            await this.handleAction(cacheName, "add", `Saved cache ${cacheName}`);
        }
    }

    private async handleAction (cacheName: string, action: "add" | "remove" | "wipe", successMessage: string): Promise<void> {
        if (await this.handlePrompt(cacheName, action)) {
            this.cacheActions(cacheName, action);
            this.log(successMessage);
        }
    }

    private cacheActions (cacheName: string, action: "add" | "remove" | "wipe" | "available"): void {
        let cacheData: Record<string, any> = this.loadCacheData();

        switch (action) {
        case "add": {
            const stateSnapshot = this.stateManager.snapshot;
            const dockerComposeSnapshot = this.getDockerFile();
            cacheData[cacheName] = {
                state: {
                    hash: this.hash(JSON.stringify(stateSnapshot)),
                    snapshot: stateSnapshot
                },
                dockerCompose: {
                    hash: this.hash(dockerComposeSnapshot.toString("utf-8")),
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
        }

        this.saveCacheData(cacheData);
    }

    private loadCacheData (): Record<string, any> {
        if (existsSync(this.stateCacheFile)) {
            const fileContent = yaml.parse(readFileSync(this.stateCacheFile, "utf-8"));
            return fileContent || {};
        }
        return {};
    }

    private saveCacheData (cacheData: Record<string, any>): void {
        writeFileSync(this.stateCacheFile, yaml.stringify(cacheData));
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

    private hash (data: string): string {
        const sha256Hash = createHash("sha256");
        sha256Hash.update(data);
        return sha256Hash.digest("hex");
    }

    private getDockerFile (): Buffer {
        const dockerComposeFilePath = join(this.chsDevConfig.projectPath, "docker-compose.yaml");
        return yaml.parse(readFileSync(dockerComposeFilePath).toString("utf-8"));
    }

    private async handlePrompt (cacheName: string, action: "add" | "remove" | "wipe"): Promise<boolean> {
        const messages: Record<string, string> = {
            add: `This will save the cache or overwrite it if it already exists. Proceed?`,
            remove: `Do you want to delete the cache named ${cacheName}?`,
            wipe: "Do you want to delete all saved caches?"
        };
        return await confirm(messages[action]);
    }
}
