import { Args, Command, Config, Flags } from "@oclif/core";
import loadConfig from "../helpers/config-loader.js";
import ChsDevConfig from "../model/Config.js";
import { ComposeLogViewer } from "../run/compose-log-viewer.js";
import { DependencyCache } from "../run/dependency-cache.js";
import { DockerCompose } from "../run/docker-compose.js";
import { Inventory } from "../state/inventory.js";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { ContainerType } from "../model/index.js";

type ReloadFunc = (serviceName: string, flags: any) => Promise<void>

const NODE_BUILDER = "node";
const NGINX_BUILDER = "nginx";
const REPOSITORY_BUILDER = "repository";
const NO_CHANGES_PATTERN = /"?([\w-]+)"?\s+\|\s+.*No changes\./;

/**
 * The Reload command is responsible for rebuilding and restarting a specified service
 * running in development mode. This allows developers to load any changes made to the
 * source code without restarting the entire environment.
 */
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
    private readonly dockerCompose: DockerCompose;
    private readonly composeLogViewer: ComposeLogViewer;
    private readonly reloadStrategies: Map<string, ReloadFunc>;

    constructor (argv: string[], config: Config) {
        super(argv, config);
        const logger = {
            log: (msg: string) => this.log(msg)
        };

        this.chsDevConfig = loadConfig();
        this.composeLogViewer = new ComposeLogViewer(this.chsDevConfig, logger);
        this.dockerCompose = new DockerCompose(this.chsDevConfig, logger);
        this.inventory = new Inventory(this.chsDevConfig.projectPath, config.cacheDir);
        this.dependencyCache = new DependencyCache(this.chsDevConfig.projectPath);
        this.reloadStrategies = new Map<string, ReloadFunc>([
            [NODE_BUILDER, this.reloadNodeService.bind(this)],
            [NGINX_BUILDER, this.reloadNginxService.bind(this)],
            [REPOSITORY_BUILDER, this.reloadRepositoryService.bind(this)],
            ["default", this.reloadJavaService.bind(this)]
        ]);
    }

    async run (): Promise<any> {
        const { args, flags } = await this.parse(Reload);
        const serviceName: string = args.service;

        if (!this.isServiceValid(serviceName)) return;

        const serviceBuilder = this.checkServicesBuilder(serviceName);

        if (!serviceBuilder) {
            return this.error(`Service '${serviceName}' builder property missing in service definition`);
        }

        const reloadStrategy = (this.reloadStrategies.get(serviceBuilder) || this.reloadStrategies.get("default")) as ReloadFunc;

        try {
            await reloadStrategy(serviceName, flags);
        } catch (error) {
            await this.handleError(error);
        }
    }

    /**
     * Validates if the service exists in the inventory.
     * @param serviceName - Name of the service to validate
     * @returns True if the service is valid, otherwise throws an error
     */
    private isServiceValid (serviceName?: string): boolean {
        if (!this.inventory.services.some(service => service.name === serviceName)) {
            this.error(`Service ${serviceName} is not found in inventory`);
        }
        return true;
    }

    /**
     * Checks the builder type of the specified service from its docker-compose file.
     * @param serviceName - Name of the service
     * @returns The builder type (e.g., "node") or undefined if not found
     */
    private checkServicesBuilder (serviceName: string): string | undefined {
        let serviceBuilder;
        const developmentService = this.inventory.services.find(s => s.name === serviceName && !s.source.includes("tilt/"));
        if (developmentService && developmentService.builder) {
            serviceBuilder = developmentService.builder;
        }
        return serviceBuilder;
    }

    /**
     * Reloads a Node.js service by restarting container.
     * @param serviceName - Name of the service to reload
     * @param flags - Flags passed to the command
     */
    private async reloadNodeService (serviceName: string, flags: any): Promise<void> {
        if (flags.force) {
            this.log(`Reloading Node Container: ${serviceName}`);
            await this.dockerCompose.restart(serviceName);
        } else {
            this.log(`Node services automatically sync changes. Reloading is not required.`);
            this.log(`Use the --force flag (-f) to restart the container if necessary.`);
        }
    }

    /**
     * Reloads a Nginx service by restarting container.
     * @param serviceName - Name of the service to reload
     */
    private async reloadNginxService (serviceName: string): Promise<void> {
        this.log(`Service: ${serviceName} restarted`);
        await this.dockerCompose.restart(serviceName);
    }

    /**
     * Reloads a Java service by rebuilding and restarting it.
     * @param serviceName - Name of the service to reload
     *  @param flags - Flags passed to the command
     */
    private async reloadJavaService (serviceName: string, flags: any): Promise<void> {
        const codeHashFile = this.getCodeHashFile(serviceName);
        if (flags.force && codeHashFile) {
            unlinkSync(codeHashFile);
        }
        this.log(`Service: ${serviceName} building...`);

        const noChangesFound = await this.dockerCompose.build(`${serviceName}-builder`, ContainerType.BUILDER, NO_CHANGES_PATTERN);
        if (noChangesFound) {
            this.log(`No changes found in code. Terminating reload.`);
            this.log(`Use the --force flag (-f) to rebuild if necessary.`);
        } else {
            this.log(`Service: ${serviceName} restarting...`);
            await this.dockerCompose.restart(serviceName);
            this.dockerCompose.healthCheck([serviceName]);
        }
    }

    /**
     * Reloads a Repository service by rebuilding the container.
     * @param serviceName - Name of the service to reload
     *  @param flags - Flags passed to the command
     */
    private async reloadRepositoryService (serviceName: string): Promise<void> {
        this.log(`Service: ${serviceName} building...`);
        const boss = await this.dockerCompose.build(`${serviceName}`, ContainerType.APPLICATION);
        this.dockerCompose.healthCheck([serviceName]);

    }

    /**
     * Handles errors that occur during the reload process.
     * Logs recent Docker Compose logs and throws the error.
     * @param error - The error object
     */
    private async handleError (error: unknown): Promise<void> {
        this.log(`\n${"-".repeat(80)}`);
        this.log("Recent Docker Compose Logs:");
        await this.composeLogViewer.view({
            tail: "5",
            follow: false
        });
        this.error(error as Error);
    }

    /**
     * Gets the codeHash file and returns undefined if it doesnt exist.
     * @param serviceName - Name of the service
     */
    private getCodeHashFile (serviceName: string): string | undefined {
        const codeHashFile = join(
            this.chsDevConfig.projectPath,
            "local",
            serviceName,
            "out/.code.hash"
        );
        return existsSync(codeHashFile) ? codeHashFile : undefined;
    }
}
