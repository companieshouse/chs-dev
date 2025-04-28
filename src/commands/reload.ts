import { Args, Command, Config, Flags } from "@oclif/core";
import { readFileSync } from "fs";
import yaml from "yaml";
import loadConfig from "../helpers/config-loader.js";
import ChsDevConfig from "../model/Config.js";
import { ComposeLogViewer } from "../run/compose-log-viewer.js";
import { DependencyCache } from "../run/dependency-cache.js";
import { DockerCompose } from "../run/docker-compose.js";
import { Inventory } from "../state/inventory.js";
import { StateManager } from "../state/state-manager.js";

export default class Reload extends Command {

    static description = "Rebuilds and restarts the supplied service running " +
        "in development mode to load in any changes to source code";

    static args = {
        service: Args.string({
            required: true,
            description: "Name of the service"
        })
    };

    static flags = {
        force: Flags.boolean({
            required: false,
            allowNo: false,
            default: false,
            description: "Forcefully reload service and force a rebuild",
            name: "force",
            char: "f",
            aliases: ["force"]
        })
    };

    private readonly inventory: Inventory;
    private readonly dependencyCache: DependencyCache;
    private readonly chsDevConfig: ChsDevConfig;
    private readonly stateManager: StateManager;
    private readonly dockerCompose: DockerCompose;
    private readonly composeLogViewer: ComposeLogViewer;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        const logger = {
            log: (msg: string) => this.log(msg)
        };

        this.chsDevConfig = loadConfig();
        this.composeLogViewer = new ComposeLogViewer(this.chsDevConfig, logger);
        this.dockerCompose = new DockerCompose(this.chsDevConfig, logger);
        this.stateManager = new StateManager(this.chsDevConfig.projectPath);
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.dependencyCache = new DependencyCache(this.chsDevConfig.projectPath);
    }

    async run (): Promise<any> {
        const { args, flags } = await this.parse(Reload);
        const serviceName: string = args.service;

        if (!this.isServiceValid(serviceName)) return;

        const serviceBuilder = this.checkServicesBuilder(serviceName);

        if (!serviceBuilder) {
            return this.error(`Service '${serviceName}' builder property missing in docker-compose`);
        }

        try {
            if (serviceBuilder === "node") {
                this.log(`Reloading Node Service: ${serviceName}`);
                await this.dockerCompose.restart(serviceName);
            } else {
                this.reloadNonNodeService(serviceName);
            }
        } catch (error) {
            await this.handleError(error);
        }

    }

    private isServiceValid (serviceName?: string): boolean {
        if (!this.inventory.services.some(service => service.name === serviceName)) {
            this.error(`Service ${serviceName} is not found in inventory`);
        }
        return true;
    }

    private checkServicesBuilder (serviceName: string): string | undefined {
        let serviceBuilder;
        const developmentService = this.inventory.services.find(s => s.name === serviceName && !s.source.includes("tilt/"));
        if (developmentService && developmentService.source) {
            const dockerCompose = yaml.parse(readFileSync(developmentService.source).toString("utf-8"));
            dockerCompose.services[serviceName].labels.forEach((label: string) => {
                if (/^chs\.local\.builder=/.test(label)) {
                    serviceBuilder = label.split("=")[1].toString().toLowerCase();
                }
            });
        }
        return serviceBuilder;
    }

    private async reloadNonNodeService (serviceName: string): Promise<void> {
        this.dependencyCache.update();
        this.log(`Service: ${serviceName} building...`);
        await this.dockerCompose.build(`${serviceName}-builder`);
        this.log(`Service: ${serviceName} restarting...`);
        await this.dockerCompose.restart(serviceName);
        this.dockerCompose.healthStatus([serviceName]);
    }

    private async handleError (error: unknown): Promise<void> {
        this.log(`\n${"-".repeat(80)}`);
        this.log("Recent Docker Compose Logs:");
        await this.composeLogViewer.view({
            tail: "5",
            follow: false
        });
        this.error(error as Error);
    }
}
