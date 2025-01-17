import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { EOL } from "os";
import { join } from "path";
import yaml from "yaml";
import { getAllFilesInDirectory, getInitialDockerComposeFile } from "../helpers/docker-compose-file.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";
import { Service } from "../model/Service.js";
import { getBuilder } from "../state/builders.js";
import DevelopmentDockerComposeSpecFactory from "./development/development-docker-compose-factory.js";
import { AbstractFileGenerator } from "./file-generator.js";
import { deduplicate } from "../helpers/array-reducers.js";

interface LiveUpdate {
  liveUpdate: boolean;
}

type ServiceWithLiveUpdate = Service & LiveUpdate;

type RunnableServicesObject = {
    runnableServices: ServiceWithLiveUpdate[],
    infrastructureSources: string[]
}

export class DockerComposeFileGenerator extends AbstractFileGenerator {

    constructor (path: string) {
        super(path, "docker-compose.yaml");
    }

    generateDockerComposeFile (services: ServiceWithLiveUpdate[], runnableObjects = {} as RunnableServicesObject, hasExcludedServices = false) {
        const { runnableServices: runnableServicesList, infrastructureSources } = runnableObjects;
        let dockerCompose = getInitialDockerComposeFile(this.path);
        const runnableServices = runnableServicesList ?? services;

        dockerCompose = this.addIncludePropertiesToMainDockerCompose(dockerCompose, { runnableServices, infrastructureSources }, hasExcludedServices);

        // Setup the ingress-proxy's dependencies (i.e. every service with an ingress route)
        dockerCompose.services["ingress-proxy"].depends_on = this.listIngressDependencies(runnableServices);

        this.writeFile(
            yaml.stringify(dockerCompose).split(EOL),
            EOL
        );
    }

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

        const { runnableServices, infrastructureSources } = this.handleExcludedServices(services, excluded);

        runnableServices.filter(service => service.liveUpdate
            ? this.generateDevelopmentServiceDockerComposeFile(service, undefined, excluded)
            // create services on dev mode
            : this.generateDockerComposeFileForRunnableServices(service, excluded));
        // create services on not on dev mode

        // update the dockercompose on root
        this.generateDockerComposeFile(services, { runnableServices, infrastructureSources }, true);

    }

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

    private isExcludedServiceOrScript (service: Service | string, excludedServices: string[]) {
        const serviceName = typeof service === "object" ? service.name : service;
        return excludedServices.some(ex => new RegExp(`^execute-${ex}-scripts$`).test(serviceName) || ex === serviceName);
    }

    private removeExcludedServicesAndScripts (services: ServiceWithLiveUpdate[], excluded?: string[] | undefined):ServiceWithLiveUpdate[] {
        return typeof excluded !== "undefined"
            ? services.filter(service => !this.isExcludedServiceOrScript(service, excluded))
            : services;
    }

    private handleExcludedServices (
        services: ServiceWithLiveUpdate[],
        excluded: string[] = []
    ): RunnableServicesObject {
        const runnableResults: RunnableServicesObject = {
            runnableServices: [],
            infrastructureSources: []
        };

        if (!excluded.length) {
            runnableResults.runnableServices = services;
            return runnableResults;
        }

        const result = this.removeExcludedServicesAndScripts(services, excluded);

        const infrastructureSources = new Set<string>();

        runnableResults.runnableServices = result.filter(service => {
            if (service.module === "infrastructure") {
                infrastructureSources.add(service.source);
                return false;
            }
            return true;
        });
        runnableResults.infrastructureSources = Array.from(infrastructureSources);

        return runnableResults;
    }

    private generateDockerComposeFileForRunnableServices (service: ServiceWithLiveUpdate, excludedServices: string[]) {
        const runnableServicesComposeFile = join("exclusion-runnable-services", `${service.name}.docker-compose.yaml`);
        let dockerComposeConfig: DockerComposeSpec = yaml.parse(readFileSync(service.source).toString("utf-8"));

        dockerComposeConfig = this.removeExcludedServiceFromDependOn(dockerComposeConfig, excludedServices);

        const updatedYamlContent = yaml.stringify(dockerComposeConfig);

        this.writeFile(
            updatedYamlContent.split(EOL),
            EOL,
            runnableServicesComposeFile
        );
    }

    private removeExcludedServiceFromDependOn (dockerComposeConfig: DockerComposeSpec, excludedServices: string[]): DockerComposeSpec {
        const updatedServices = Object.entries(dockerComposeConfig.services).map(([serviceName, serviceSpec]) => {
            if (!serviceSpec.depends_on) return [serviceName, serviceSpec];

            if (this.isObjectFormat(serviceSpec.depends_on)) {
                serviceSpec.depends_on = this.filterObjectDependencies(serviceSpec.depends_on, excludedServices);

                // Remove empty object
                if (this.isEmptyObject(serviceSpec.depends_on)) {
                    delete serviceSpec.depends_on;
                }
            } else if (Array.isArray(serviceSpec.depends_on)) {
                serviceSpec.depends_on = this.filterArrayDependencies(serviceSpec.depends_on, excludedServices);

                // Remove empty array
                if (serviceSpec.depends_on.length === 0) {
                    delete serviceSpec.depends_on;
                }
            }

            return [serviceName, serviceSpec];
        });

        return {
            ...dockerComposeConfig,
            services: Object.fromEntries(updatedServices)
        };
    }

    private isObjectFormat (dependsOn: unknown): dependsOn is Record<string, any> {
        return typeof dependsOn === "object" && !Array.isArray(dependsOn);
    }

    private filterObjectDependencies (
        dependsOn: Record<string, any>,
        excludedServices: string[]
    ): Record<string, any> {
        return Object.fromEntries(
            Object.entries(dependsOn).filter(
                ([dependency]) => !this.isExcludedServiceOrScript(dependency, excludedServices)
            )
        );
    }

    private isEmptyObject (obj: Record<string, any>): boolean {
        return Object.keys(obj).length === 0;
    }

    private filterArrayDependencies (dependsOn: string[], excludedServices: string[]): string[] {
        return dependsOn.filter(dependency => !this.isExcludedServiceOrScript(dependency, excludedServices));
    }

    private addIncludePropertiesToMainDockerCompose (dockerCompose:DockerComposeSpec, { runnableServices, infrastructureSources: infrastructuralServicesSources }:RunnableServicesObject, hasExcludedServices): DockerComposeSpec {
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
