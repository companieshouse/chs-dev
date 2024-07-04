import { Command, Config, Flags } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";

export default class Available extends Command {

    static description = "Lists all the available services";

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

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.inventory = new Inventory(process.cwd(), config.cacheDir);
    }

    async run (): Promise<any> {
        const services: string[] = [];
        for (const service of this.inventory.services) {
            services.push(service.name);
        }
        const serviceNames = services.sort((a, b) => a.localeCompare(b));

        const { flags } = await this.parse(Available);

        if (flags.json) {
            this.logJson({
                services: serviceNames
            });
        } else {
            this.log("Available services:");

            services.forEach((service) => {
                this.log(` - ${service}`);
            });
        }
    }

}
