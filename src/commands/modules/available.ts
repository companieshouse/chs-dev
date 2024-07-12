import { Command, Config, Flags } from "@oclif/core";
import { Inventory } from "../../state/inventory.js";

export default class Available extends Command {
    static description = "Lists the available modules";

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

        this.inventory = new Inventory(
            process.cwd(), config.cacheDir
        );

    }

    async run (): Promise<any> {
        const { flags } = await this.parse(Available);

        if (flags.json) {
            this.logJson({
                modules: [
                    ...this.inventory.modules.map(({ name }) => name)
                ]
            });
        } else {
            this.log("Available modules:");
            for (const module of this.inventory.modules) {
                this.log(` - ${module.name}`);
            }
        }
    }

}
