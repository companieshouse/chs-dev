import { Command, Config, Flags } from "@oclif/core";
import { StateManager } from "../../state/state-manager.js";
import ChsDevConfig from "../../model/Config.js";
import loadConfig from "../../helpers/config-loader.js";

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
    private readonly chsDevConfig: ChsDevConfig;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
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
