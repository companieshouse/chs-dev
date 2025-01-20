import { readFileSync } from "fs";
import { join } from "path";
import { DockerComposeSpec } from "../../model/DockerComposeSpec.js";
import Service from "../../model/Service.js";
import yaml from "yaml";
import { isEmptyObject, isObjectFormat } from "../../helpers/index.js";
import { ServiceWithLiveUpdate, RunnableServicesObject } from "../interface/index.js";

interface ExclusionComposeFile {
    runnableServicesComposeFile: string,
    updatedYamlContent:string
}

/**
 * Handles the creation of exclusion generated docker-compose files.
 *
*/
export default class ExclusionDockerComposeSpecFactory {

    /**
 * Excludes specified services and returns the runnable services.
 * If no exclusions are provided, all services are returned as runnable.
 * Separates infrastructure services (e.g., MongoDB, Elasticsearch) from main services.
 * Handles executable services correctly by skipping the creation of new compose files and reusing the previous ones when excluded.
 *
 * @param services - The list of services to process.
 * @param excluded - An array of service names to exclude.
 * @returns The runnable services and infrastructure sources after exclusion handling.
 */
    handleExcludedServices (
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

        return this.handleInfrastructuralServices(result);
    }

    /**
 * Generates a Docker Compose file for services that are marked as runnable,
 * excluding the services specified in the excludedServices array.
 *
 * @param service - The service object for which to generate the Compose file.
 * @param excludedServices - The list of services to exclude from the Compose file.
 * @returns The path to the generated Docker Compose file and its updated content.
 */
    generateDockerComposeFileForExclusionRunnableServices (service: ServiceWithLiveUpdate, excludedServices: string[]): ExclusionComposeFile {
        const runnableServicesComposeFile = join("exclusion-runnable-services", `${service.name}.docker-compose.yaml`);
        let dockerComposeConfig: DockerComposeSpec = yaml.parse(readFileSync(service.source).toString("utf-8"));

        dockerComposeConfig = this.removeExcludedServiceFromDependOn(dockerComposeConfig, excludedServices);

        return {
            runnableServicesComposeFile,
            updatedYamlContent: yaml.stringify(dockerComposeConfig)
        };

    }

    /**
 * Removes the excluded services from the 'depends_on' field of the Docker Compose configuration.
 * The method handles both object and array formats for the 'depends_on' field.
 *
 * @param dockerComposeConfig - The original Docker Compose configuration.
 * @param excludedServices - The list of services to exclude from the 'depends_on' field.
 * @returns The updated Docker Compose configuration with exclusions applied.
 */
    removeExcludedServiceFromDependOn (dockerComposeConfig: DockerComposeSpec, excludedServices: string[]): DockerComposeSpec {
        const updatedServices = Object.entries(dockerComposeConfig.services).map(([serviceName, serviceSpec]) => {
            if (!serviceSpec.depends_on) return [serviceName, serviceSpec];

            if (isObjectFormat(serviceSpec.depends_on)) {
                serviceSpec.depends_on = this.filterObjectDependencies(serviceSpec.depends_on, excludedServices);

                // Remove empty object
                if (isEmptyObject(serviceSpec.depends_on)) {
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

    // Seperate Infrastructural Services and Non Infrastrutural services
    private handleInfrastructuralServices (runnableServices:ServiceWithLiveUpdate[]): RunnableServicesObject {
        const infrastructureSources = new Set<string>();

        const servicesWithoutInfrastruture = runnableServices.filter(service => {
            if (service.module === "infrastructure") {
                infrastructureSources.add(service.source);
                return false;
            }
            return true;
        });

        return {
            runnableServices: servicesWithoutInfrastruture,
            infrastructureSources: Array.from(infrastructureSources)
        };
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

    private filterArrayDependencies (dependsOn: string[], excludedServices: string[]): string[] {
        return dependsOn.filter(dependency => !this.isExcludedServiceOrScript(dependency, excludedServices));
    }

}
