import { Args, Command, Config } from "@oclif/core";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import loadConfig from "../../helpers/config-loader.js";
import { confirm } from "../../helpers/user-input.js";
import ChsDevConfig from "../../model/Config.js";
import { StateManager } from "../../state/state-manager.js";

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
const EXPORT_STATE_DIR = ".exported_state_cache";

export default class Export extends Command {
    static description = "Export current state of chs-dev into a saved file";

    static args = {
        name: Args.string({
            required: true,
            description: "Name of the exported file"
        })
    };

    private readonly stateManager: StateManager;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly exportedStateDir: string;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();
        this.exportedStateDir = join(this.chsDevConfig.projectPath, EXPORT_STATE_DIR);

        if (!existsSync(this.exportedStateDir)) {
            mkdirSync(this.exportedStateDir, { recursive: true });
        }

        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
    }

    async run (): Promise<void> {
        const { args: { name } } = await this.parse(Export);

        if (await confirm(`Export current state of chs-dev into a saved file: ${name}?`)) {
            this.exportState(name);
        }

    }

    private exportState (exportFileName: string): void {
        const exportedFilename = join(this.exportedStateDir, `${exportFileName}.yaml`);

        const exportData = [
            "# DO NOT MODIFY MANUALLY",
            yaml.stringify(this.getExportData())
        ];

        writeFileSync(exportedFilename, exportData.join("\n\n"));
        this.log(`Exported state destination: ${exportedFilename}`);
    }

    private getExportData (): StateCache {
        const stateSnapshot = this.stateManager.snapshot;
        const dockerComposeSnapshot = this.getDockerFile();
        return {
            state: {
                hash: this.hash(yaml.stringify(stateSnapshot)),
                snapshot: stateSnapshot
            },
            dockerCompose: {
                hash: this.hash(yaml.stringify(dockerComposeSnapshot)),
                snapshot: dockerComposeSnapshot
            }
        };

    }

    private getDockerFile (): Buffer {
        const dockerComposeFilePath = join(
            this.chsDevConfig.projectPath,
            "docker-compose.yaml"
        );
        return yaml.parse(readFileSync(dockerComposeFilePath).toString("utf-8"));
    }

    private hash (data: string): string {
        const sha256Hash = createHash("sha256");
        sha256Hash.update(data);
        return sha256Hash.digest("hex");
    }

}
