import { Args, Command, Config, Flags } from "@oclif/core";
import AbstractStateModificationCommand from "../AbstractStateModificationCommand.js";
import { ServiceFactory } from "../../run/service-factory.js";
import { serviceValidator } from "../../helpers/validator.js";
import loadConfig from "../../helpers/config-loader.js";
import { Inventory } from "../../state/inventory.js";

export default class Create extends Command {
    static description = "Creates a new service in inventory based on a supplied service";

    static args = {
        repoName: Args.string({
            required: true,
            description: "Name of the github repository the new service is for",
            name: "Service name"
        }),
        module: Args.string({
            required: false,
            description: "Name of the module of the new service",
            name: "module name"
        })
    };

    static flags = {
        from: Flags.string({
            name: "from",
            char: "f",
            aliases: ["from"],
            description: "Name of the service to use as the template for the new service",
            required: true
        }),
        containerName: Flags.string({
            name: "container name",
            char: "n",
            aliases: ["containerName"],
            description: "Name of the container",
            required: false
        }),
        descriptionLabel: Flags.string({
            name: "CHS description",
            char: "d",
            aliases: ["description"],
            description: "Description of the service describing its role in CHS and local environment",
            required: false
        }),
        traefikRuleLabel: Flags.string({
            name: "Traefik rule",
            char: "r",
            aliases: ["traefikRule"],
            description: "Traefik rule label value - defines the routing rule for Traefik to route traffic to service",
            required: false
        }),
        traefikPrioityLabel: Flags.string({
            name: "Traefik priority",
            char: "p",
            aliases: ["traefikPriority"],
            description: "Provides a value for the priority of the routes to the service",
            required: false
        }),
        gitHubRepoBranchName: Flags.string({
            name: "Branch Name",
            char: "B",
            aliases: ["branchName"],
            description: "Name of the Git branch to clone by default for the service (if different to default repo branch)",
            required: false
        })
    };

    private serviceFactory: ServiceFactory;
    private validOriginServicePredicate: (serviceName: string) => boolean;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        const chsDevConfig = loadConfig();
        const inventory = new Inventory(chsDevConfig.projectPath, config.cacheDir);

        this.serviceFactory = new ServiceFactory(chsDevConfig, inventory);
        this.validOriginServicePredicate = serviceValidator(
            inventory, this.error
        );
    }

    async run (): Promise<any> {
        const { flags, args } = await this.parse(Create);

        if (this.validOriginServicePredicate(flags.from)) {
            await this.serviceFactory.createNewBasedOn(
                flags.from,
                {
                    gitHubRepoName: args.repoName,
                    moduleName: args.module,
                    containerName: flags.containerName,
                    descriptionLabel: flags.descriptionLabel,
                    traefikRuleLabel: flags.traefikRuleLabel,
                    traefikPriorityLabel: flags.traefikPrioityLabel,
                    gitHubRepoBranchName: flags.gitHubRepoBranchName
                }
            );
        } else {
            this.error("Invalid source service specified - ensure it is in inventory");
        }

    }

}
