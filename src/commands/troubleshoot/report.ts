import { Command, Flags, Config, Args } from "@oclif/core";
import TroubleshootReport from "../../run/TroubleshootReport.js";
import load from "../../helpers/config-loader.js";
import { Inventory } from "../../state/inventory.js";
import { StateManager } from "../../state/state-manager.js";

export default class Report extends Command {

    static description = "Produces an artifact containing resources to aid " +
        "others providing assistance";

    static flags = {
        skipTroubleshootAnalyses: Flags.boolean({
            name: "skipTroubleshootAnalyses",
            char: "A",
            aliases: ["skipTroubleshootAnalyses"],
            description: "Whether to skip producing the analyses output if " +
                "not provided as input (Not recommended)"
        }),
        troubleshootAnalyses: Flags.file({
            exists: true,
            required: false,
            multiple: false,
            description: "Previously generated analyses of the environment",
            char: "a",
            aliases: ["analyses"]
        })
    };

    static args = {
        outputDirectory: Args.directory({
            exists: true,
            required: true,
            description: "Directory to output the produced report to",
            name: "outputDirectory"
        })
    };

    private readonly report: TroubleshootReport;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        const chsDevConfig = load();

        const inventory = new Inventory(chsDevConfig.projectPath, config.cacheDir);
        const stateManager = new StateManager(chsDevConfig.projectPath);
        const logger = { log: (msg: string) => this.log(msg) };

        this.report = TroubleshootReport.create(
            chsDevConfig,
            inventory,
            stateManager,
            logger
        );
    }

    async run (): Promise<any> {
        const { args, flags } = await this.parse(Report);

        const createOptions: {
            outputDirectory: string,
            skipTroubleshootAnalyses?: boolean,
            troubleshootAnalyses?: string
        } = {
            outputDirectory: args.outputDirectory
        };

        if (flags.skipTroubleshootAnalyses) {
            createOptions.skipTroubleshootAnalyses = true;
        }

        if (typeof flags.troubleshootAnalyses !== "undefined") {
            createOptions.troubleshootAnalyses = flags.troubleshootAnalyses;
        }

        await this.report.create(createOptions);
    }

}
