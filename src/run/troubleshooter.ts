import { mkdtempSync, rmSync } from "fs";
import Config from "../model/Config.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { defaultTroubleshootActions } from "./troubleshoot/action/default-troubleshoot-actions.js";
import { TroubleshootAction } from "./troubleshoot/action/TroubleshootAction.js";
import { defaultTroubleshootArtifactTasks } from "./troubleshoot/artifact/default-troubleshoot-artifact-tasks.js";
import { OutputTroubleshootArtifactTask } from "./troubleshoot/artifact/OutputTroubleshootArtifactTask.js";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "../helpers/spawn-promise.js";
import LogEverythingLogHandler from "./logs/LogEverythingLogHandler.js";
import { Logger } from "./logs/logs-handler.js";
import { OutputTroubleshootArtifactContext } from "./troubleshoot/artifact/TroubleshootArtifactContext.js";

/**
 * A class which will aid the user perform troubleshooting within their
 * environment and will offer guidance for common errors.
 */
export class Troubleshooter {

    private readonly config: Config;
    private readonly inventory: Inventory;
    private readonly stateManager: StateManager;
    private readonly logger: Logger;
    private readonly troubleshootActions: TroubleshootAction[];
    private readonly outputTroubleshootArtifactTasks: OutputTroubleshootArtifactTask[];

    private constructor (
        config: Config,
        cacheDir: string,
        logger: Logger,
        troubleshootActions: TroubleshootAction[],
        outputTroubleshootArtifactTasks: OutputTroubleshootArtifactTask[]
    ) {
        this.config = config;
        this.inventory = new Inventory(config.projectPath, cacheDir);
        this.stateManager = new StateManager(config.projectPath);
        this.logger = logger;
        this.troubleshootActions = troubleshootActions;
        this.outputTroubleshootArtifactTasks = outputTroubleshootArtifactTasks;
    }

    /**
     * Works throug the troubleshoot actions and attempts to resolve them. When
     * running in auto mode, it will not run the prompts to the user
     * @param autoMode whether/not to run only the automated tasks/checks
     * @returns true/false whether the trouble has been isolated and resolved
     */
    async attemptResolution (autoMode: boolean = false): Promise<boolean> {
        let resolvedAll: boolean | undefined;

        for (const action of this.troubleshootActions) {
            const actionResolved = await this.attemptAction(action, autoMode);

            resolvedAll = typeof resolvedAll === "undefined"
                ? actionResolved
                : actionResolved && resolvedAll;
        }

        return resolvedAll || false;
    }

    /**
     * Works through the output tasks and builds up a temporary directory
     * containing pertinent information about the failures and the environment
     * before creating a zip file
     * @param outputDirectory Destination for the created zip file
     * @returns Promise which resolves when output produced otherwise will
     * be rejected
     */
    async outputTroubleshootArtifact (outputDirectory: string): Promise<any> {
        const temporaryDirectory = mkdtempSync(join(tmpdir(), "chs-dev"));
        const outputContext = new OutputTroubleshootArtifactContext(this.config, temporaryDirectory);
        const taskOptions = {
            inventory: this.inventory,
            stateManager: this.stateManager,
            config: this.config,
            outputDirectory: temporaryDirectory,
            context: outputContext
        };

        try {
            for (const task of this.outputTroubleshootArtifactTasks) {
                await task.run(taskOptions);
            }

            outputContext.write();

            await this.createZipFile(outputDirectory, temporaryDirectory);

            return Promise.resolve();
        } finally {
            rmSync(
                temporaryDirectory,
                {
                    recursive: true
                }
            );
        }

    }

    private createZipFile (outputDirectory: string, temporaryDirectory: string) {
        const date = new Date(Date.now());

        const dateLabel = date.toLocaleDateString(
            "en-CA", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        );

        const timeLabel = date.toLocaleTimeString("en-GB", {});

        const zipFileName = `troubleshoot-${dateLabel}-${timeLabel}.zip`;

        return spawn(
            "zip",
            [
                "-j",
                "-r",
                join(outputDirectory, zipFileName),
                temporaryDirectory
            ],
            {
                logHandler: new LogEverythingLogHandler(this.logger)
            }
        );
    }

    private async attemptAction (action: TroubleshootAction, autoMode: boolean): Promise<boolean> {
        let result: boolean = false;

        if (typeof action.autoTask !== "undefined") {
            result = await action.autoTask({ inventory: this.inventory, stateManager: this.stateManager, config: this.config });
        }

        if (!result && !autoMode && typeof action.getOutputViaPrompt !== "undefined") {
            result = await action.getOutputViaPrompt({ inventory: this.inventory, stateManager: this.stateManager, config: this.config });
        }

        return result;
    }

    static createNew (
        config: Config,
        cacheDir: string,
        logger: Logger,
        troubleshootActions?: TroubleshootAction[],
        outputTroubleshootArtifactTasks?: OutputTroubleshootArtifactTask[]
    ): Troubleshooter {
        return new Troubleshooter(
            config,
            cacheDir,
            logger,
            troubleshootActions || defaultTroubleshootActions,
            outputTroubleshootArtifactTasks || defaultTroubleshootArtifactTasks
        );
    }
}

export default Troubleshooter;
