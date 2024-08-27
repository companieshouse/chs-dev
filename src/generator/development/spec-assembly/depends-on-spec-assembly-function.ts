import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import { SpecAssemblyFunction } from "./spec-assembly-function.js";

const dependenciesAsObject = (dependencies: Record<string, any> | string[]) => {
    if (Array.isArray(dependencies)) {
        return dependencies.map(
            dependency => [dependency, { condition: "service_started" }]
        ).reduce((previous, [dependencyName, dependencySpec]) => ({
            ...previous,
            [dependencyName]: dependencySpec
        }), {});
    }

    return dependencies;
};

/**
 * Sets up the service's dependendencies correctly converting any services
 * using a list to a mapping
 * @param developmentDockerComposeSpec spec under construction
 * @param specAssemblyFunctionOptions SpecAssemblyFunctionOptions defining the
 *  options for assembling the spec
 */
const dependsOnSpecAssemblyFunction: SpecAssemblyFunction = (developmentDockerComposeSpec: DockerComposeSpec, {
    service,
    serviceDockerComposeSpec
}) => {
    if (typeof serviceDockerComposeSpec.services[service.name].depends_on !== "undefined") {
        developmentDockerComposeSpec.services[service.name].depends_on = {
            ...developmentDockerComposeSpec.services[service.name].depends_on,
            ...dependenciesAsObject(serviceDockerComposeSpec.services[service.name].depends_on as string[] | Record<string, any>)
        };
    }
};

export default dependsOnSpecAssemblyFunction;
