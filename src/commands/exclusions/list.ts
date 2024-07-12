import { Command, Config, Flags } from "@oclif/core";
import { StateManager } from "../../state/state-manager.js";

export default class List extends Command {

    static description = "lists the current list of services which have been excluded";

    static flags = {
        json: Flags.boolean({
            name: "json",
            char: "j",
            aliases: ["json"],
            default: false,
            allowNo: false,
            description: "Output to log as json"
        })
    };

    private readonly stateManager: StateManager;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.stateManager = new StateManager(process.cwd());
    }

    async run (): Promise<any> {
        const { flags } = await this.parse(List);

        if (flags.json) {
            this.logJson(
                {
                    exclusions: [
                        ...this.stateManager.snapshot.excludedServices
                    ]
                }
            );
        } else {
            this.log("Current exclusions:");

            for (const exclusion of this.stateManager.snapshot.excludedServices) {
                this.log(` - ${exclusion}`);
            }
        }
    }

}
