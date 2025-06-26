import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { EOL } from "os";
import { join } from "path";
import yaml from "yaml";
import { deduplicate } from "../helpers/array-reducers.js";
import { getInitialDockerComposeFile } from "../helpers/docker-compose-file.js";
import { getAllFilesInDirectory } from "../helpers/file-utils.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";
import { Service } from "../model/Service.js";
import { getBuilder } from "../state/builders.js";
import DevelopmentDockerComposeSpecFactory from "./development/development-docker-compose-factory.js";
import ExclusionDockerComposeSpecFactory from "./exclusion/exclusion-docker-compose-factory.js";
import { AbstractFileGenerator } from "./file-generator.js";
import { RunnableServicesObject, ServiceWithLiveUpdate } from "./interface/index.js";

export class DockerComposeFileGenerator extends AbstractFileGenerator {

    constructor (path: string) {
        super(path, "docker-compose.yaml");
    }

    /**
     * Generates the main Docker Compose file in the root directory based on the service configurations.
     * Add ingress-proxy service and its dependencies.
     * @param services - List of all services with live updates.
     * @param  {runnableObjects} - a List of runnable services and infrastrutural services generated from an exclusion execution.
     * @param hasExcludedServices - Indicates if there are excluded services.
     */
    generateDockerComposeFile (services: ServiceWithLiveUpdate[], runnableObjects = {} as RunnableServicesObject, hasExcludedServices = false) {
        const { runnableServices: runnableServicesList, infrastructureSources } = runnableObjects;
        let dockerCompose = getInitialDockerComposeFile(this.path);
        const runnableServices = runnableServicesList ?? services;

        dockerCompose = this.handleIncludePropertiesInMainDockerCompose(dockerCompose, { runnableServices, infrastructureSources }, hasExcludedServices);

        // Setup the ingress-proxy's dependencies (i.e. every service with an ingress route)
        dockerCompose.services["ingress-proxy"].depends_on = this.listIngressDependencies(runnableServices);

        this.writeFile(
            yaml.stringify(dockerCompose).split(EOL),
            EOL
        );
    }

    /**
     * Generates a development-specific Docker Compose file for a service.
     * @param service - The service for which the file is generated.
     * @param builderVersion - Optional builder version.
     * @param excludedServices - List of excluded service names.
     */
    // Create the development compose file
    generateDevelopmentServiceDockerComposeFile (service: Service, builderVersion: string | undefined, excludedServices: string[] = []) {
        const developmentServicePath = join(this.path, "local", service.name);

        if (!existsSync(developmentServicePath)) {
            mkdirSync(developmentServicePath);
        }

        const developmentComposeFile = join("local", service.name, "docker-compose.yaml");

        const builderDockerComposeSpec = getBuilder(this.path, service.builder, builderVersion);
        const dockerComposeSpecFactory = new DevelopmentDockerComposeSpecFactory(
            builderDockerComposeSpec, this.path
        );

        let dockerComposeConfig = yaml.parse(readFileSync(service.source).toString("utf-8"));

        if (excludedServices.length) {
            const exclusionFactory = new ExclusionDockerComposeSpecFactory();
            dockerComposeConfig = exclusionFactory.removeExcludedServiceFromDependOn(dockerComposeConfig, excludedServices);
        }

        const developmentDockerComposeSpec = dockerComposeSpecFactory.create(
            dockerComposeConfig, service
        );

        // Create the development compose file
        this.writeFile(
            yaml.stringify(developmentDockerComposeSpec).split(EOL),
            EOL,
            developmentComposeFile
        );
    }

    /**
     * Generates exclusion filtered Docker Compose files in the `exclusion-filtered-compose-files` directory and updates the main docker-compose.yaml file `includes` property as a list of the generated exclusion filtered docker-compose files.
     * create exlusion filtered docker-compose for non-development mode services.
     * update development-mode services docker-compose file by removing excluded services from its depend_on property.
     * update main docker-compose file `include` and `depends_on` properties appropriately.
     * @param services - List of all services with live updates.
     * @param excluded - List of excluded service names.
     */
    generateExclusionDockerComposeFiles (services: ServiceWithLiveUpdate[], excluded: string[] | undefined) {
        const exclusionDirPath = join(this.path, "exclusion-runnable-services");

        if (!excluded || !excluded?.length) {
            this.generateDockerComposeFile(services, {} as RunnableServicesObject);
            rmSync(exclusionDirPath, { recursive: true, force: true });
            return;
        }

        if (existsSync(exclusionDirPath)) {
            rmSync(exclusionDirPath, { recursive: true, force: true });
        }
        mkdirSync(exclusionDirPath);

        const exclusionFactory = new ExclusionDockerComposeSpecFactory();

        const { runnableServices, infrastructureSources } = exclusionFactory.handleExcludedServices(services, excluded);

        runnableServices.forEach(service => {
            if (service.liveUpdate) {
                // Create services in dev mode
                this.generateDevelopmentServiceDockerComposeFile(service, undefined, excluded);
            } else {
                // Create services not in dev mode
                const { runnableServicesComposeFile, updatedYamlContent } =
            exclusionFactory.generateDockerComposeFileForExclusionRunnableServices(service, excluded);

                this.writeFile(
                    updatedYamlContent.split(EOL),
                    EOL,
                    runnableServicesComposeFile
                );
            }
        });

        // update the dockercompose on root
        this.generateDockerComposeFile(services, { runnableServices, infrastructureSources }, true);

    }

    /**
     * Lists the ingress dependencies for a given list of services, identifying services that have an ingressRoute defined.
     * It also determines the condition (either 'service_started' or 'service_healthy') based on the presence of a healthcheck.
     *
     * @param services - The list of services to examine.
     * @returns An object where the keys are the service names and the values are their ingress conditions and restart settings.
     */
    private listIngressDependencies (services: ServiceWithLiveUpdate[]): Record<string, {condition: string, restart: boolean}> {
        return services
            .reduce((dependencySpec: Record<string, {condition: string, restart: boolean}>, service) => {
                // Selects services which have an ingressRoute defined
                if ((typeof service.metadata.ingressRoute !== "undefined" && service.metadata.ingressRoute !== null)) {
                    // Condition is selected based upon the presence of healthcheck - when present it will wait for
                    // the service to be healthy as opposed to just started
                    dependencySpec[service.name] = {
                        condition: (typeof service.metadata.healthcheck === "undefined" || service.metadata.healthcheck === null) ? "service_started" : "service_healthy",
                        restart: true
                    };
                }

                return dependencySpec;
            }, {});
    }

    /**
     * Modifies the main Docker Compose configuration by modifing the include property based on whether excluded services exist.
     * If there are excluded services, it includes Compose files for both local and exclusion services.
     * If no exclusions, it only includes the relevant source paths.
     *
     * @param dockerCompose - The original Docker Compose configuration.
     * @param runnableServices - The list of runnable services.
     * @param infrastructuralServicesSources - The sources for infrastructural services.
     * @param hasExcludedServices - A flag indicating whether there are excluded services.
     * @returns The modified Docker Compose configuration with the appropriate services included.
     */
    private handleIncludePropertiesInMainDockerCompose (dockerCompose:DockerComposeSpec, { runnableServices, infrastructureSources: infrastructuralServicesSources }:RunnableServicesObject, hasExcludedServices): DockerComposeSpec {
        if (hasExcludedServices) {
            const localServicesCompose = runnableServices
                .filter(service => service.liveUpdate)
                .map(service => join(this.path, "local", service.name, "docker-compose.yaml"));

            const genratedServicesCompose = getAllFilesInDirectory(join(this.path, "exclusion-runnable-services"));

            dockerCompose.include = [...localServicesCompose, ...genratedServicesCompose, ...infrastructuralServicesSources];
        } else {
            dockerCompose.include = runnableServices.map(
                service => service.liveUpdate
                    ? join(this.path, "local", service.name, "docker-compose.yaml")
                    : service.source
            ).reduce(deduplicate, []);
        }
        return dockerCompose;
    }
}
