import { Command, Config, Flags } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";
import ChsDevConfig from "../../model/Config.js";
import loadConfig from "../../helpers/config-loader.js";

export default class Services extends Command {

    static description = "Lists all services which are available to enable in development mode";

    static flags = {
        json: Flags.boolean({
            name: "json",
            char: "j",
            aliases: ["json"],
            default: false,
            allowNo: false,
            description: "output as json"
        })
    };

    private readonly inventory: Inventory;
    private readonly chsDevConfig: ChsDevConfig;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.chsDevConfig = loadConfig();

        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);

    }

    async run (): Promise<any> {
        const { flags } = await this.parse(Services);

        const availableServices = this.inventory.services
            .filter(item => item.repository !== null && item.repository !== undefined)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (flags.json) {
            this.logJson({
                services: [
                    ...availableServices.map(service => service.name)
                ]
            });
        } else {
            this.log("Available services:");
            for (const service of availableServices) {
                this.log(` - ${service.name} (${service.description})`);
            }
        }
    }

}
