import { Command } from "@oclif/core";

export default class ComposeLogs extends Command {

    static description = "This command is DEPRECATED, use logs -C instead";

    static hidden = true;

    static examples = [
        {
            description: "view all compose logs",
            command: "<%= config.bin %> <%= command.id %> -C"
        },
        {
            description: "follow compose logs",
            command: "<%= config.bin %> <%= command.id %> -C -f"
        },
        {
            description: "load the last line in the compose logs",
            command: "<%= config.bin %> <%= command.id %> -C -n 1"
        }
    ];

    run (): Promise<any> {
        return this.error(
            "This command has been removed in favour of `logs -C`", {
                suggestions: [
                    "run chs-dev logs -C"
                ]
            }
        );
    }

}
