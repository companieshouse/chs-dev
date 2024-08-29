import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import buildArgsSpecAssemblyFunction from "./build-args-spec-assembly-function.js";
import builderSecretsSpecAssemblyFunction from "./builder-secrets-spec-assembly-function.js";
import builderSpecAssemblyFunction from "./builder-spec-assembly-function.js";
import dependsOnSpecAssemblyFunction from "./depends-on-spec-assembly-function.js";
import envFileSpecAssemblyFunction from "./env-file-assembly-function.js";
import nonServiceTlaSpecAssemblyFunction from "./non-services-tla-spec-assembly-function.js";
import { simpleSpecAssemblyFunctionFactory } from "./simple-spec-assembly-function.js";
import { SpecAssemblyFunction, SpecAssemblyFunctionOptions } from "./spec-assembly-function.js";

const specFieldsWhichAreImmutable = [
    "environment",
    "labels",
    "networks",
    "image",
    "healthcheck",
    "ports",
    "expose",
    "dns",
    "dns_search",
    "volumes"
];

const specAssemblyFunctions: SpecAssemblyFunction[] = [
    builderSpecAssemblyFunction,
    dependsOnSpecAssemblyFunction,
    ...specFieldsWhichAreImmutable.map(simpleSpecAssemblyFunctionFactory),
    buildArgsSpecAssemblyFunction,
    envFileSpecAssemblyFunction,
    builderSecretsSpecAssemblyFunction,
    nonServiceTlaSpecAssemblyFunction
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
