import { Args, Command, Config, Flags } from "@oclif/core";
import { DockerCompose } from "../run/docker-compose.js";
import configLoader from "../helpers/config-loader.js";
import { ComposeLogViewer } from "../run/compose-log-viewer.js";

export default class Logs extends Command {
    static aliases: string[] = ["service-logs", "compose-logs"];

    /**
     * Show deprecation message when aliases are used and prompt the user to
     * use correct command
     */
    static deprecateAliases = true;

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
