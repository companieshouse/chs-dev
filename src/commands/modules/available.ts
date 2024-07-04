import { Command, Config } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";

export default class Available extends Command {
    static description = "Lists the available modules";

    private readonly inventory: Inventory;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.inventory = new Inventory(
            process.cwd(), config.cacheDir
        );

    }

    async run (): Promise<any> {
        this.log("Available modules:");
        for (const module of this.inventory.modules) {
            this.log(` - ${module.name}`);
        }
    }

}
