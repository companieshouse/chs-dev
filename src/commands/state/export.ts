import { Args, Command, Config } from "@oclif/core";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import loadConfig from "../../helpers/config-loader.js";
import { getGeneratedDockerComposeFile } from "../../helpers/docker-compose-file.js";
import { writeContentToFile } from "../../helpers/file-utils.js";
import { hashAlgorithm } from "../../helpers/index.js";
import { confirm } from "../../helpers/user-input.js";
import ChsDevConfig from "../../model/Config.js";
import { StateManager } from "../../state/state-manager.js";
import { EXPORT_STATE_DIR, validateNameFormat } from "./state-cache-utils.js";

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

export default class Export extends Command {
    static description = `Export the current state of chs-dev as a named file into the '${EXPORT_STATE_DIR}' directory. This is useful when you need to share your setup with others or for backup purposes. The exported file will contain the current state of chs-dev, including the Docker Compose configuration and the state snapshot.`;

    static args = {
        name: Args.string({
            required: true,
            description: "Specify the export file name using letters, numbers, and optional underscores or hypens."
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

        validateNameFormat(name);

        if (await confirm(`Export current state of chs-dev to file named: '${name}'?`)) {
            this.exportState(name);
        }

    }

    private exportState (exportFileName: string): void {
        const exportedFilenamePath = join(this.exportedStateDir, `${exportFileName}.yaml`);
        writeContentToFile(this.getExportData(), exportedFilenamePath);

        this.log(`Exported state destination: ${exportedFilenamePath}`);
    }

    private getExportData (): StateCache {
        const stateSnapshot = this.stateManager.snapshot;
        const dockerComposeSnapshot = getGeneratedDockerComposeFile(this.chsDevConfig.projectPath);
        return {
            state: {
                hash: hashAlgorithm(yaml.stringify(stateSnapshot)),
                snapshot: stateSnapshot
            },
            dockerCompose: {
                hash: hashAlgorithm(yaml.stringify(dockerComposeSnapshot)),
                snapshot: dockerComposeSnapshot
            }
        };

    }

}
