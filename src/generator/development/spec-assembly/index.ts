import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import buildArgsSpecAssemblyFunction from "./build-args-spec-assembly-function.js";
import builderSecretsSpecAssemblyFunction from "./builder-secrets-spec-assembly-function.js";
import builderSpecAssemblyFunction from "./builder-spec-assembly-function.js";
import dependsOnSpecAssemblyFunction from "./depends-on-spec-assembly-function.js";
import envFileSpecAssemblyFunction from "./env-file-assembly-function.js";
import { immutableServiceFieldsSpecAssemblyFunction } from "./immutable-service-fields-spec-assembly-function.js";
import nonServiceTlaSpecAssemblyFunction from "./non-services-tla-spec-assembly-function.js";
import { SpecAssemblyFunction, SpecAssemblyFunctionOptions } from "./spec-assembly-function.js";
import { volumeSpecAssemblyFunction } from "./volume-spec-assembly-function.js";

const specFieldsWhichAreMutable = [
    "build",
    "develop",
    "env_file",
    "volumes",
    "depends_on",
    "secrets"
];

const specAssemblyFunctions: SpecAssemblyFunction[] = [
    immutableServiceFieldsSpecAssemblyFunction(specFieldsWhichAreMutable),
    builderSpecAssemblyFunction,
    dependsOnSpecAssemblyFunction,
    buildArgsSpecAssemblyFunction,
    envFileSpecAssemblyFunction,
    nonServiceTlaSpecAssemblyFunction,
    volumeSpecAssemblyFunction,
    builderSecretsSpecAssemblyFunction
];

/**
 * Executes all the specAssemblyFunctions with the docker compose spec supplied
 * and supplied options
 * @param developmentDockerComposeSpec spec under construction
 * @param options SpecAssemblyFunctionOptions defining the
 *  options for assembling the spec
 */
const apply = (developmentDockerComposeSpec: DockerComposeSpec, options: SpecAssemblyFunctionOptions) => {
    specAssemblyFunctions.forEach(assemblyFunction => {
        assemblyFunction(developmentDockerComposeSpec, options);
    });
};

export default apply;
