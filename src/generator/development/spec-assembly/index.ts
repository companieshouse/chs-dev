import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import buildArgsSpecAssemblyFunction from "./build-args-spec-assembly-function.js";
import builderSpecAssemblyFunction from "./builder-spec-assembly-function.js";
import dependsOnSpecAssemblyFunction from "./depends-on-spec-assembly-function.js";
import { simpleSpecAssemblyFunctionFactory } from "./simple-spec-assembly-function.js";
import { SpecAssemblyFunction, SpecAssemblyFunctionOptions } from "./spec-assembly-function.js";

const specFieldsWhichAreImmutable = [
    "environment",
    "labels",
    "networks",
    "image",
    "healthcheck"
];

const specAssemblyFunctions: SpecAssemblyFunction[] = [
    builderSpecAssemblyFunction,
    dependsOnSpecAssemblyFunction,
    ...specFieldsWhichAreImmutable.map(simpleSpecAssemblyFunctionFactory),
    buildArgsSpecAssemblyFunction
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
