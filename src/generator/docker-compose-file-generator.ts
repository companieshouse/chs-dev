import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { EOL } from "os";
import { join } from "path";
import yaml from "yaml";
import { deduplicate } from "../helpers/array-reducers.js";
import { getAllFilesInDirectory, getInitialDockerComposeFile } from "../helpers/docker-compose-file.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";
import { Service } from "../model/Service.js";
import { getBuilder } from "../state/builders.js";
import DevelopmentDockerComposeSpecFactory from "./development/development-docker-compose-factory.js";
import { AbstractFileGenerator } from "./file-generator.js";

interface LiveUpdate {
  liveUpdate: boolean;
}

type ServiceWithLiveUpdate = Service & LiveUpdate;

/**
 * Class responsible for generating Docker Compose files based on service configurations.
 */
export class DockerComposeFileGenerator extends AbstractFileGenerator {
    /**
     * Constructor for DockerComposeFileGenerator.
     * @param path - The path to the directory where the Docker Compose root file will be created.
     */
    constructor (path: string) {
        super(path, "docker-compose.yaml");
    }

    /**
     * Removes excluded services from the list of services.
     * @param services - List of all services with live updates.
     * @param excluded - List of service names to exclude.
     * @returns Filtered list of services.
     */
    private removeExcludedServices (services: ServiceWithLiveUpdate[], excluded?: string[] | undefined):ServiceWithLiveUpdate[] {
        return typeof excluded !== "undefined"
            ? services.filter(service => !excluded.includes(service.name))
            : services;
    }

    /**
     * Adds services to the `include` property of the Docker Compose configuration.
     * Handles live updates and excluded services.
     * The development enabled services docker-compose.yaml file in local repository are linked into the include property instead of  new docker-compose.yaml file will not be generated.
     * @param dockerCompose - Docker Compose configuration object.
     * @param runnableServices - List of services to include.
     * @param hasExcludedServices - Indicates if there are excluded services.
     * @returns Updated Docker Compose configuration.
     */
    private addIncludePropertiesToDockerCompose (dockerCompose:DockerComposeSpec, runnableServices:ServiceWithLiveUpdate[], hasExcludedServices = false): DockerComposeSpec {
        if (!hasExcludedServices) {
            dockerCompose.include = runnableServices.map(
                service => service.liveUpdate
                    ? join(this.path, "local", service.name, "docker-compose.yaml")
                    : service.source
            ).reduce(deduplicate, []);
        } else {
            const includes: string[] = [];
            runnableServices.forEach(service => {
                if (service.liveUpdate) {
                    includes.push(join(this.path, "local", service.name, "docker-compose.yaml"));
                }
            });
            const otherDocker = getAllFilesInDirectory(join(this.path, "exclude"));
            includes.push(...otherDocker);
            dockerCompose.include = includes;
        }
        return dockerCompose;
    }

    /**
     * Removes excluded services from the `depends_on` property of each service in the Docker Compose configuration.
     * Handles different formats of `depends_on`: array format and object format.
     * @param dockerComposeConfig - Docker Compose configuration object.
     * @param excludedServices - List of excluded service names.
     * @returns Updated Docker Compose configuration.
     */
    private removeExcludedServiceFromDependOn (dockerComposeConfig: DockerComposeSpec, excludedServices: string[]): DockerComposeSpec {
        for (const serviceSpec of Object.values(dockerComposeConfig.services)) {
            if (serviceSpec.depends_on) {
                // Handle object format
                if (typeof serviceSpec.depends_on === "object" && !Array.isArray(serviceSpec.depends_on)) {
                    excludedServices?.forEach((excludedService) => {
                        if (excludedService in serviceSpec.depends_on!) {
                            delete serviceSpec.depends_on![excludedService];
                        }
                    });
                }

                // Handle array format
                if (Array.isArray(serviceSpec.depends_on)) {
                    const includes = serviceSpec.depends_on.filter(
                        (dependency) => !excludedServices?.includes(dependency)
                    );
                    if (includes.length > 0) {
                        serviceSpec.depends_on = includes;
                    } else {
                        delete serviceSpec.depends_on;
                    }
                }
            }
        }
        return dockerComposeConfig;
    }

    /**
     * Generates a Docker Compose file in the `exclude` directory for a specific runnable service and remove excluded services from the depend_on property in the generated docker compose.
     * @param service - Service for which the file is generated.
     * @param excludedServices - List of excluded service names.
     */
    private generateDockerComposeFileForIncludedServices (service: ServiceWithLiveUpdate, excludedServices: string[]) {
        const exclusionComposeFile = join("exclude", `${service.name}.docker-compose.yaml`);
        let dockerComposeConfig: DockerComposeSpec = yaml.parse(readFileSync(service.source).toString("utf-8"));

        dockerComposeConfig = this.removeExcludedServiceFromDependOn(dockerComposeConfig, excludedServices);

        const updatedYamlContent = yaml.stringify(dockerComposeConfig);

        this.writeFile(
            updatedYamlContent.split(EOL),
            EOL,
            exclusionComposeFile
        );
    }

    /**
     * Generates dependencies for the ingress proxy service by including services with ingress routes.
     * @param services - List of all services with live updates.
     * @returns Dependencies for the ingress proxy.
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
     * Generates the main Docker Compose file in the root directory based on the service configurations.
     * Add ingress-proxy service and its dependencies.
     * @param services - List of all services with live updates.
     * @param hasExcludedServices - Indicates if there are excluded services.
     * @param includedServices - List of included services.
     */
    generateDockerComposeFile (services: ServiceWithLiveUpdate[], hasExcludedServices = false, includedServices?:ServiceWithLiveUpdate[]) {
        let dockerCompose = getInitialDockerComposeFile(this.path);

        const runnableServices = includedServices ?? this.removeExcludedServices(services);

        dockerCompose = this.addIncludePropertiesToDockerCompose(dockerCompose, runnableServices, hasExcludedServices);

        // Setup the ingress-proxy's dependencies (i.e. every service with an ingress route)
        dockerCompose.services["ingress-proxy"].depends_on = this.listIngressDependencies(runnableServices);

        this.writeFile(
            yaml.stringify(dockerCompose).split(EOL),
            EOL
        );
    }

    /**
     * Generates exclusion-specific Docker Compose files in the `exclude` directory and updates the main docker-compose.yaml file `includes` property to list the generated exclusion-specific docker-compose files.
     * create exlusion-specific docker-compose for non-development mode services.
     * update development-mode services docker-compose file depend_on property with excluded services.
     * update main docker-compose file `include` and `depends_on` properties appropriately.
     * @param services - List of all services with live updates.
     * @param excluded - List of excluded service names.
     */
    generateExclusionDockerComposeFiles (services: ServiceWithLiveUpdate[], excluded: string[] | undefined) {
        const exclusionDirPath = join(this.path, "exclude");

        if (!excluded || !excluded?.length) {
            this.generateDockerComposeFile(services);
            rmSync(exclusionDirPath, { recursive: true, force: true });
            return;
        }

        const runnableServices = this.removeExcludedServices(services, excluded);

        if (existsSync(exclusionDirPath)) {
            rmSync(exclusionDirPath, { recursive: true, force: true });
        }
        mkdirSync(exclusionDirPath);

        const liveUpdateServices: ServiceWithLiveUpdate[] = [];

        runnableServices.forEach(service => {
            if (!service.liveUpdate) { // dont create services on dev mode
                this.generateDockerComposeFileForIncludedServices(service, excluded);
            } else {
                liveUpdateServices.push(service);
            }
        });

        if (liveUpdateServices.length) {
            // update docker compose in local dir - for dev mode
            liveUpdateServices.forEach(service => {
                this.generateDevelopmentServiceDockerComposeFile(service, undefined, excluded);
            });
        }

        // update the dockercompose on root
        this.generateDockerComposeFile(services, true, runnableServices);

    }

    /**
     * Generates a development-specific Docker Compose file for a service.
     * @param service - The service for which the file is generated.
     * @param builderVersion - Optional builder version.
     * @param excludedServices - List of excluded service names.
     */
    // Create the development compose file and touch files
    generateDevelopmentServiceDockerComposeFile (service: Service, builderVersion: string | undefined, excludedServices: string[] = []) {
        const developmentServicePath = join(this.path, "local", service.name);

        if (!existsSync(developmentServicePath)) {
            mkdirSync(developmentServicePath);
        }

        const developmentComposeFile = join("local", service.name, "docker-compose.yaml");
        const touchFileName = ".touch";
        const touchFile = join("local", service.name, touchFileName);

        const builderDockerComposeSpec = getBuilder(this.path, service.builder, builderVersion);
        const dockerComposeSpecFactory = new DevelopmentDockerComposeSpecFactory(
            builderDockerComposeSpec, this.path
        );

        let dockerComposeConfig = yaml.parse(readFileSync(service.source).toString("utf-8"));

        if (excludedServices.length) {
            dockerComposeConfig = this.removeExcludedServiceFromDependOn(dockerComposeConfig, excludedServices);
        }

        const developmentDockerComposeSpec = dockerComposeSpecFactory.create(
            dockerComposeConfig, service
        );

        // Create the development compose file and touch files
        this.writeFile(
            yaml.stringify(developmentDockerComposeSpec).split(EOL),
            EOL,
            developmentComposeFile
        );

        this.writeFile(
            [
                "Touching this file will trigger a rebuild of your service"
            ],
            EOL,
            touchFile
        );
    }
}
