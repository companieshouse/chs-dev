import { Args, Command, Config, Flags } from "@oclif/core";
import { DockerCompose } from "../run/docker-compose.js";
import configLoader from "../helpers/config-loader.js";
import { ComposeLogViewer } from "../run/compose-log-viewer.js";

export default class Logs extends Command {
    static description = "Outputs the logs for services and compose logs (i.e. logs from 'up' and 'down' commands)";

    static strict = false;

    static args = {
        serviceName: Args.string({
            name: "serviceNames",
            required: false,
            description: "specify the service names of the logs to follow, when not specified follows aggregated logs"
        })
    };

    static flags = {
        compose: Flags.boolean({
            char: "C",
            aliases: ["compose"],
            default: false,
            allowNo: false,
            description: "View the compose logs rather than service logs"
        }),
        follow: Flags.boolean({
            char: "f",
            aliases: ["follow"],
            description: "Follow the logs",
            default: false,
            allowNo: false
        }),
        tail: Flags.string({
            char: "n",
            aliases: ["tail"],
            default: "all",
            description: "Number of lines from the end of the logs"
        })
    };

    static examples = [
        {
            description: "view all aggregated service logs",
            command: "<%= config.bin %> <%= command.id %>"
        },
        {
            description: "follow aggregated service logs",
            command: "<%= config.bin %> <%= command.id %> -f"
        },
        {
            description: "follow logs for service",
            command: "<%= config.bin %> <%= command.id %> service-one service-two -f"
        },
        {
            description: "load the last line in the aggregated service logs",
            command: "<%= config.bin %> <%= command.id %> -n 1"
        },
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

    private dockerCompose: DockerCompose;
    private composeLogViewer: ComposeLogViewer;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        const chsDevConfig = configLoader();
        const logger = {
            log: (msg: string) => this.log(msg)
        };

        this.dockerCompose = new DockerCompose(chsDevConfig, logger);
        this.composeLogViewer = new ComposeLogViewer(chsDevConfig, logger);
    }

    async run (): Promise<any> {
        const { argv, flags } = await this.parse(Logs);

        if (flags.compose) {
            return await this.composeLogViewer.view({
                tail: flags.tail,
                follow: flags.follow
            });
        }

        const logsArgs = {
            serviceNames: argv as string[],
            tail: flags.tail,
            follow: flags.follow,
            signal: undefined
        };

        await this.dockerCompose.logs(logsArgs);
    }

}
