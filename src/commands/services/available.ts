import { Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";

export default class Available extends Command {

    static description = "Lists all the available services";

    private readonly inventory: Inventory;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.inventory = new Inventory(process.cwd(), config.cacheDir);
    }

    async run (): Promise<any> {
        this.log("Available services:");
        const services: string[] = [];
        for (const service of this.inventory.services) {
            services.push(service.name);
        }
        services.sort((a, b) => a.localeCompare(b));
        services.forEach((service) => {
            this.log(` - ${service}`);
        });
    }

}
