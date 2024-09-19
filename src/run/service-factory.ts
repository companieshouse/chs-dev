import { readFileSync, writeFileSync } from "fs";
import Config from "../model/Config.js";
import { Inventory } from "../state/inventory.js";
import yaml from "yaml";
import { ServiceGenerator } from "../generator/service-generator.js";
import { confirm, editor, input } from "../helpers/user-input.js";
import { join } from "path";
import CONSTANTS from "../model/Constants.js";

/**
 * Options for creating a new Service providing values for the different
 * attributes to be set on the new service.
 */
type CreateNewBasedOnOptions = {
    /**
     * Name of the GitHub repo/service which is being created
     */
    gitHubRepoName: string;

    /**
     * Name of the module which the new service is being added to
     */
    moduleName?: string;

    /**
     * Name of the container for the service
     */
    containerName?: string;

    /**
     * Description of the new service
     */
    descriptionLabel?: string;

    /**
     * Traefik routing label value
     */
    traefikRuleLabel?: string;

    /**
     * Traefik priority label
     */
    traefikPriorityLabel?: string;

    /**
     * Name of the GitHub branch (if different to default branch set in GitHub
     * settings)
     */
    gitHubRepoBranchName?: string
}

/**
 * Orchestration service for creating new Services based on other services.
 */
export class ServiceFactory {

    private readonly serviceGenerator: ServiceGenerator;

    constructor (private readonly config: Config, private readonly inventory: Inventory) {
        this.serviceGenerator = new ServiceGenerator(config);
    }

    /**
     * Creates a new service based on the service referenced by the
     * `serviceName` supplied. Assumes the service exists otherwise will do
     * nothing. Will prompt the user whether or not they want to set the values
     * for the different unique attributes of the service.
     * @param serviceName Name of the service which is being used as the basis
    *       of the new service
     * @param options Properties for the new service being created which may be
     *      overridden by use input
     */
    async createNewBasedOn (
        serviceName: string,
        options: CreateNewBasedOnOptions
    ) {
        const newServiceName = options.gitHubRepoName.replaceAll(".", "-");

        this.validateRequest(newServiceName);

        const moduleName = options.moduleName || await input(
            "Enter the name of the module the service is part of"
        );

        const service = this.inventory.services.find(service => service.name === serviceName);

        if (typeof service !== "undefined") {
            const sourceFile = readFileSync(service.source).toString("utf8").replaceAll(service.name, newServiceName);
            const initialServiceFile = yaml.parse(sourceFile);

            const generatedSpec = this.serviceGenerator.generateDockerComposeSpecForService(
                newServiceName,
                moduleName,
                {
                    initialSpecValue: initialServiceFile,
                    containerName: options.containerName || await this.promptUserToProvideValueFor("container name"),
                    descriptionLabel: options.descriptionLabel || await this.promptUserToProvideValueFor("description label"),
                    gitHubRepoBranchName: options.gitHubRepoBranchName || await this.promptUserToProvideValueFor("repository branch label"),
                    traefikPriorityLabel: options.traefikPriorityLabel || await this.promptUserToProvideValueFor("Traefik priority label"),
                    traefikRuleLabel: options.traefikRuleLabel || await this.promptUserToProvideValueFor("Traefik rule label")
                }
            );

            if (await confirm("Do you want to modify the generated service?")) {
                const modifiedFile = await editor(
                    "Modify the file accordingly",
                    {
                        initialValue: generatedSpec,
                        waitForUserInput: false
                    }
                );

                if (modifiedFile !== generatedSpec) {
                    writeFileSync(
                        join(
                            this.config.projectPath,
                            CONSTANTS.MODULES_DIRECTORY,
                            moduleName,
                            `${newServiceName}.docker-compose.yaml`
                        ),
                        Buffer.from(modifiedFile, "utf8")
                    );
                }
            }

            console.log(`Service ${newServiceName} created`);
        }
    }

    private async promptUserToProvideValueFor (
        descriptionOfField: string
    ): Promise<string | undefined> {
        const provideValue = await confirm(
            `Do you want to provide a value for ${descriptionOfField}?`
        );

        if (provideValue) {
            return input(
                `Enter a value for the ${descriptionOfField}`
            );
        } else {
            return undefined;
        }
    }

    private validateRequest (
        serviceName: string
    ) {
        const serviceWithName = this.inventory.services.find(
            service => service.name === serviceName
        );

        if (typeof serviceWithName !== "undefined") {
            throw new Error(`A service with name: ${serviceName} already exists in module ${serviceWithName.module}`);
        }
    }
}

export default ServiceFactory;
