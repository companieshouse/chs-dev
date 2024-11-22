
import Stats from "../../../information/repositories/report/Stats.js";
import { Command, Config, Args, Flags, Parser } from "@oclif/core";

export default class GenerateRepositoryStats extends Command {

    static description: string = "Generates a report documenting key information about repositories";

    private stats: Stats;

    constructor (argv: string[], config: Config) {
        super(argv, config,);
        this.stats = new Stats();
    }

    async run (): Promise<any> {

        const {args, flags} = await Parser.parse(process.argv.slice(2), {
            args: {
                information: Args.string({required: true}),
                repository: Args.string({required: true}),
                report: Args.string({required: true}),
            },
            flags: {
              stats: Flags.boolean({char: 'f'}),
            },
          })

        if(flags.stats){
            this.stats.generateReport().catch(console.error);
            console.log(`${args.report} from ${flags.stats}`)
        }
    }
}