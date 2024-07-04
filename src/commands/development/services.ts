import { Command, Config, Flags } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";

export default class Services extends Command {

    static description = "Lists all services which are available to enable in development mode";

    private readonly inventory: Inventory;

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

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.inventory = new Inventory(process.cwd(), config.cacheDir);

    }

    async run (): Promise<any> {
        const { flags } = await this.parse(Services);

        const availableServices = this.inventory.services.filter(item => item.repository !== null && item.repository !== undefined);
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
