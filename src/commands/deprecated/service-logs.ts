import { Command } from "@oclif/core";

export default class ServiceLogs extends Command {

    static description = "This command is DEPRECATED, use logs instead";

    static hidden = true;

    static examples = [
        {
            description: "view all aggregated logs",
            command: "<%= config.bin %> <%= command.id %> logs"
        },
        {
            description: "follow aggregated logs",
            command: "<%= config.bin %> <%= command.id %> -f"
        },
        {
            description: "follow logs for service",
            command: "<%= config.bin %> <%= command.id %> -f service-one service-two"
        },
        {
            description: "load the last line in the aggregated logs",
            command: "<%= config.bin %> <%= command.id %> -n 1"
        }
    ];

    run (): Promise<any> {
        return this.error(
            "This command has been removed in favour of `logs`", {
                suggestions: [
                    "run chs-dev logs"
                ]
            }
        );
    }

}
