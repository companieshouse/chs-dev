import { Args, Config, Flags, ux } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { serviceValidator } from "../../helpers/validator.js";
import { DockerCompose } from "../../run/docker-compose.js";

export default class Disable extends AbstractStateModificationCommand {

    static description: string = "Removes a service from development mode";

    static args = {
        services: Args.string({
            name: "services",
            required: true,
            description: "names of services to be removed to development mode"
        })
    };

    static flags = {
        noPull: Flags.boolean({
            name: "no-pull",
            required: false,
            default: false,
            char: "P",
            aliases: ["noPull"],
            description: "Does not perform a docker compose pull to reset the service to what is stored in ECR"
        })
    };

    private readonly dockerCompose: DockerCompose;

    constructor (argv: string[], config: Config) {
        super(argv, config, "service");

        this.argumentValidationPredicate = serviceValidator(this.inventory, this.error, true);
        this.validArgumentHandler = this.handleValidService;
        this.dockerCompose = new DockerCompose(
            this.chsDevConfig, {
                log: this.log
            }
        );
    }

    private async handleValidService (serviceName: string): Promise<void> {
        this.stateManager.excludeServiceFromLiveUpdate(serviceName);
    }

    protected async handlePostHookCall (serviceNames: string[]): Promise<void> {

        const noPull = this.flagValues?.noPull || false;

        if (!noPull) {
            for (const serviceName of serviceNames) {
                ux.action.start(`pulling service container: ${serviceName}`);
                await this.dockerCompose.pull(serviceName);
                ux.action.stop();

                this.log(`Service "${serviceName}" is disabled`);
            }

        }
    }

    protected parseArgumentsAndFlags (): Promise<{ argv: unknown[]; flags: Record<string, any>; }> {
        return this.parse(Disable);
    }
}
