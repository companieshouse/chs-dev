import { Args, Command, Config, Flags } from "@oclif/core";
import { DockerCompose } from "../run/docker-compose.js";
import configLoader from "../helpers/config-loader.js";
import { ComposeLogViewer } from "../run/compose-log-viewer.js";

export default class Logs extends Command {
    static args = {
        serviceName: Args.string({
            required: false,
            description: "specify the service name of the logs to follow, when not specified follows aggregated logs"
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
        const { args, flags } = await this.parse(Logs);

        if (flags.compose) {
            return await this.composeLogViewer.view({
                tail: flags.tail,
                follow: flags.follow
            });
        }

        const logsArgs = {
            serviceName: args.serviceName,
            tail: flags.tail,
            follow: flags.follow,
            signal: undefined
        };

        await this.dockerCompose.logs(logsArgs);
    }

}
