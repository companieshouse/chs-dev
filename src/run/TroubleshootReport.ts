import { copyFileSync, existsSync, mkdtempSync, rmdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { OutputTroubleshootArtifactContext } from "./troubleshoot/artifact/TroubleshootArtifactContext.js";
import Config from "../model/Config.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";
import { OutputTroubleshootArtifactTask } from "./troubleshoot/artifact/OutputTroubleshootArtifactTask.js";
import { spawn } from "../helpers/spawn-promise.js";
import LogEverythingLogHandler from "./logs/LogEverythingLogHandler.js";
import { Logger } from "./logs/logs-handler.js";
import { simpleColouriser } from "../helpers/colouriser.js";
import TroubleshootAnalyses from "./TroubleshootAnalyses.js";
import { defaultTroubleshootArtifactTasks } from "./troubleshoot/artifact/default-troubleshoot-artifact-tasks.js";

type CreateOptions = {
    outputDirectory: string,
    troubleshootAnalyses?: string,
    skipTroubleshootAnalyses?: boolean
}

type CreateResult = {
    success: boolean;
    error?: string
}

/**
 * A class which will produce a useful report for providing third-party support
 */
export default class TroubleshootReport {

    private readonly outputTasks: OutputTroubleshootArtifactTask[];
    private readonly config: Config;
    private readonly inventory: Inventory;
    private readonly stateManager: StateManager;
    private readonly logger: Logger;
    private readonly troubleshootAnalyses: TroubleshootAnalyses;

    constructor (
        tasks: OutputTroubleshootArtifactTask[],
        config: Config,
        inventory: Inventory,
        stateManager: StateManager,
        logger: Logger
    ) {
        this.outputTasks = tasks;
        this.config = config;
        this.inventory = inventory;
        this.stateManager = stateManager;
        this.logger = logger;
        this.troubleshootAnalyses = TroubleshootAnalyses.create(
            inventory,
            stateManager,
            config,
            logger
        );
    }

    static create (
        config: Config,
        inventory: Inventory,
        stateManager: StateManager,
        logger: Logger
    ) {
        return new TroubleshootReport(
            defaultTroubleshootArtifactTasks,
            config,
            inventory,
            stateManager,
            logger
        );
    }

    /**
     * Runs through the tasks and produces a zipfile containing the output of
     * the report and should aid someone else trying to determine what issues may
     * be occuring in a users machine
     * @param options - outputDirectory - where to write the timestamped Zip,
     *      troubleshootAnalyses - path to the analyses previously produced,
     *      skipTroubleshootAnalyses - skips production of analyses when not supplied
     * @returns success object indicating the outcome of the creation
     */
    async create ({ outputDirectory, troubleshootAnalyses, skipTroubleshootAnalyses }: CreateOptions): Promise<CreateResult> {
        const temporaryDirectory = mkdtempSync(join(tmpdir(), "chs-dev"));
        const outputContext = new OutputTroubleshootArtifactContext(this.config, temporaryDirectory);

        // Ensure the analyses present in output
        const analysesPresent = await this.ensureAnalysesProducedInOutput(
            temporaryDirectory, troubleshootAnalyses, skipTroubleshootAnalyses
        );

        let zipFileCreated = false;

        // Create zip file only if analyses present or user has decided to skip this - at their peril
        // when seeking thirdparty support
        if (analysesPresent || skipTroubleshootAnalyses) {
            zipFileCreated = await this.runTasksAndOutputZip(temporaryDirectory, outputContext, outputDirectory);
        }

        // Clean up and return the result
        this.removeDirectory(temporaryDirectory);

        if (zipFileCreated) {
            return {
                success: true
            };
        } else {
            if (!analysesPresent && typeof troubleshootAnalyses !== "undefined" && !skipTroubleshootAnalyses) {
                return {
                    success: false,
                    error: `Analyses: ${troubleshootAnalyses} does not exist`
                };
            }

            return {
                success: false,
                error: "Zip file could not be created"
            };
        }
    }

    private async runTasksAndOutputZip (temporaryDirectory: string, outputContext: OutputTroubleshootArtifactContext, outputDirectory: string) {
        let zipFileCreated = false;

        const taskOptions = {
            inventory: this.inventory,
            stateManager: this.stateManager,
            config: this.config,
            outputDirectory: temporaryDirectory,
            context: outputContext
        };

        for (const task of this.outputTasks) {
            await task.run(taskOptions);
        }

        outputContext.write();

        try {
            await this.createZipFile(
                outputDirectory,
                temporaryDirectory
            );

            zipFileCreated = true;
        } catch (error) {
            this.logger.log(
                `${simpleColouriser("ERROR!", "bold-red")} Failed to produce zip artifact: ${(error as Error).message}`
            );
        }
        return zipFileCreated;
    }

    private async ensureAnalysesProducedInOutput (temporaryDirectory: string, troubleshootAnalyses: string | undefined, skipTroubleshootAnalyses: boolean | undefined) {
        let analysesPresent = false;
        const analysesFile = join(temporaryDirectory, "analyses.json");

        if (typeof troubleshootAnalyses !== "undefined") {
            if (existsSync(troubleshootAnalyses)) {
                copyFileSync(
                    troubleshootAnalyses,
                    analysesFile
                );
                analysesPresent = true;
            }
        } else {
            if (skipTroubleshootAnalyses !== true) {
                await this.troubleshootAnalyses.perform({
                    fileOut: analysesFile,
                    quiet: true
                });

                analysesPresent = true;
            }
        }

        return analysesPresent;
    }

    private removeDirectory (temporaryDirectory: string) {
        rmSync(
            temporaryDirectory,
            {
                recursive: true,
                force: true
            }
        );
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
}
