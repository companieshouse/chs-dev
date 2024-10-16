import { Args, Command, Config, Flags } from "@oclif/core";
import Troubleshooter from "../run/troubleshooter.js";
import load from "../helpers/config-loader.js";

export default class Troubleshoot extends Command {
    static description = "Runs through a routine for trying to troubleshoot " +
        "a failure in the environment and produces an artifact containing " +
        "pertinent information for troubleshooting by another member of the team";

    static flags = {
        noGuide: Flags.boolean({
            char: "G",
            aliases: [
                "noGuide"
            ],
            allowNo: false,
            description: "Produce troubleshooting output without any guidance " +
                "for troubleshooting the issue encountered",
            default: false
        })
    };

    static args = {
        outputDirectory: Args.directory({
            exists: true,
            name: "Output Directory",
            description: "Directory to output the zipped artifact to",
            required: true
        })
    };

    private readonly troubleshooter: Troubleshooter;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.troubleshooter = Troubleshooter.createNew(
            load(),
            config.cacheDir,
            {
                log: (msg: string) => this.log(msg)
            }
        );
    }

    async run (): Promise<any> {
        const { flags, args } = await this.parse(Troubleshoot);

        await this.troubleshooter.attemptResolution(flags.noGuide);

        await this.troubleshooter.outputTroubleshootArtifact(args.outputDirectory);
    }

}
