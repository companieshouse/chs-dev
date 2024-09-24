import { join } from "path";
import { SpecAssemblyFunction, SpecAssemblyFunctionOptions } from "./spec-assembly-function.js";
import yaml from "yaml";
import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import CONSTANTS from "../../../model/Constants.js";

const formatBuilderSpec = (builderSpec: string, serviceName: string, projectPath: string) => {
    const relativeRepositoryPath = join("repositories", serviceName);
    const replacements = [
        ["<service>", serviceName],
        ["<chs_dev_root>", projectPath],
        ["<repository_path>", relativeRepositoryPath],
        ["<absolute_repository_path>", join(projectPath, relativeRepositoryPath)]
    ];

    return replacements.reduce(
        (previous, [replacePattern, replaceValue]) => previous.replaceAll(replacePattern, replaceValue), builderSpec
    );
};

/**
 * SpecAssemblyFunction that applies the elements within the builder to the
 * development docker compose spec
 * @param developmentDockerComposeSpec spec under construction
 * @param specAssemblyFunctionOptions SpecAssemblyFunctionOptions defining the
 *  options for assembling the spec
 */
const builderSpecAssemblyFunction: SpecAssemblyFunction = (developmentDockerComposeSpec, {
    service,
    projectPath,
    builderDockerComposeSpec
}: SpecAssemblyFunctionOptions) => {

    const applyServiceBuildOptions = (usingServiceDockerFile: boolean = false) => {
        const repositoryRoot = join(projectPath, "repositories", service.name);

        if (typeof developmentDockerComposeSpec.services[service.name].build === "undefined") {
            developmentDockerComposeSpec.services[service.name].build = {
                context: repositoryRoot
            };
        } else if (usingServiceDockerFile) {
            // @ts-expect-error - this is not undefined
            developmentDockerComposeSpec.services[service.name].build.context = repositoryRoot;
        }

        // append the repo context supplied in metadata to the existing value of context
        if (typeof service.metadata.repoContext !== "undefined") {
            // @ts-expect-error - this is not undefined
            const context = developmentDockerComposeSpec.services[service.name].build.context;
            // @ts-expect-error - this is not undefined
            developmentDockerComposeSpec.services[service.name].build.context = join(context, service.metadata.repoContext as string);
        } else {
            // @ts-expect-error - this is not undefined
            developmentDockerComposeSpec.services[service.name].build.context = repositoryRoot;
        }

        // Set the value of dockerfile to the value in metadata
        if (typeof service.metadata.dockerfile !== "undefined") {
            // @ts-expect-error - this is not undefined
            developmentDockerComposeSpec.services[service.name].build.dockerfile = service.metadata.dockerfile;
        // @ts-expect-error - this is not undefined
        } else if (typeof developmentDockerComposeSpec.services[service.name].build.dockerfile !== "undefined") {
            // @ts-expect-error - this is not undefined
            delete developmentDockerComposeSpec.services[service.name].build.dockerfile;
        }
    };

    // Apply the values in the builder spec now they are known and parse the yaml file
    const formattedBuilderSpec = formatBuilderSpec(builderDockerComposeSpec.builderSpec, service.name, projectPath);

    const builderSpec = yaml.parse(formattedBuilderSpec);

    // Collect any service which are not the service
    const newServices = Object.entries(builderSpec.services)
        .filter(([serviceName, serviceSpec]) => serviceName !== service.name);

    // Apply a dependency on these new service(s)
    for (const [newServiceName, newServiceSpec] of newServices) {
        developmentDockerComposeSpec.services[newServiceName] = newServiceSpec as DockerComposeSpec;

        if (typeof developmentDockerComposeSpec.services[service.name] !== "undefined") {
            if (typeof developmentDockerComposeSpec.services[service.name].depends_on === "undefined") {
                developmentDockerComposeSpec.services[service.name].depends_on = {
                    [newServiceName]: {
                        condition: "service_completed_successfully",
                        restart: true
                    }
                };
            } else {
                // @ts-expect-error - this is not undefined
                developmentDockerComposeSpec.services[service.name].depends_on[newServiceName] = {
                    condition: "service_completed_successfully",
                    restart: true
                };
            }
        }

    }

    // Merge the service attributes already in the development spec with the builders
    developmentDockerComposeSpec.services[service.name] = {
        ...builderSpec.services[service.name],
        ...developmentDockerComposeSpec.services[service.name]
    };

    // Repository or default behaviour has a few metadata items which can
    // customise the context as well as the build context
    if (service.metadata?.builderUseServiceDockerFile === CONSTANTS.BOOLEAN_LABEL_TRUE_VALUE) {
        applyServiceBuildOptions(true);
    } else if (builderDockerComposeSpec.name === "repository" &&
        typeof developmentDockerComposeSpec.services[service.name].build !== "undefined") {
        applyServiceBuildOptions();
    }
};

export default builderSpecAssemblyFunction;
