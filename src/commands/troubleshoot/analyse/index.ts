import { Args, Command, Config, Flags } from "@oclif/core";
import { Inventory } from "../../../state/inventory.js";
import TroubleshootAnalyses from "../../../run/TroubleshootAnalyses.js";
import load from "../../../helpers/config-loader.js";
import { StateManager } from "../../../state/state-manager.js";

export default class Analyse extends Command {

    static description = "Provides analyses of the environment to determine " +
        "root cause of any issues encountered. Providing information to user as " +
        "to how they can resolve the issues encountered.";

    static args = {
        outputFile: Args.file({
            name: "outputFile",
            description: "Path to output the analysis results (if desired)"
        })
    };

    static flags = {
        quiet: Flags.boolean({
            char: "q",
            aliases: ["quiet"],
            description: "Suppresses log output",
            allowNo: false
        })
    };

    private readonly troubleshootAnalyses: TroubleshootAnalyses;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        const chsDevConfig = load();

        const inventory = new Inventory(chsDevConfig.projectPath, config.cacheDir);
        const stateManager = new StateManager(chsDevConfig.projectPath);
        const logger = { log: (msg: string) => this.log(msg) };

        this.troubleshootAnalyses = TroubleshootAnalyses.create(
            inventory,
            stateManager,
            chsDevConfig,
            logger
        );
    }

    async run (): Promise<any> {
        const { flags, args } = await this.parse(Analyse);

        const performOptions: {
            quiet?: boolean,
            fileOut?: string
        } = {};

        if (flags.quiet) {
            performOptions.quiet = true;
        }

        if (typeof args.outputFile !== "undefined" && !/^\s*$/.test(args.outputFile)) {
            performOptions.fileOut = args.outputFile;
        }

        const outcome = await this.troubleshootAnalyses.perform(performOptions);

        if (!outcome.success) {
            this.exit(1);
        }
    }

}
