import { Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";

export default class Services extends Command {

    static description = "Lists all services which are available to enable in development mode";

    private readonly inventory: Inventory;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.inventory = new Inventory(process.cwd(), config.cacheDir);

    }

    async run (): Promise<any> {
        this.log("Available services:");
        for (const service of this.inventory.services.filter(item => item.repository !== null && item.repository !== undefined)) {
            this.log(` - ${service.name} (${service.description})`);
        }
    }

}
