import { join } from "path";
import { SpecAssemblyFunction } from "./spec-assembly-function.js";
import relativiseServicePath from "../utils/relativise-path.js";

const formatEnvFile = (envFileValue: string | string[], projectPath: string, source: string, serviceName: string) => {
    return relativiseServicePath(
        envFileValue, source, join(projectPath, "local", serviceName)
    );
};

/**
 * SpecAssemblyFunction which will set the env file property on the service
 * in the spec to be correct now it is at a different location
 * @param developmentDockerComposeSpec spec under construction
 * @param specAssemblyFunctionOptions SpecAssemblyFunctionOptions defining the
 *  options for assembling the spec
 */
const envFileSpecAssemblyFunction: SpecAssemblyFunction = (developmentDockerComposeSpec, {
    serviceDockerComposeSpec, service, projectPath
}) => {
    if (typeof serviceDockerComposeSpec.services[service.name].env_file !== "undefined") {
        developmentDockerComposeSpec.services[service.name].env_file = formatEnvFile(
            serviceDockerComposeSpec.services[service.name].env_file as string | string[],
            projectPath,
            service.source,
            service.name
        );
    }
};

export default envFileSpecAssemblyFunction;
