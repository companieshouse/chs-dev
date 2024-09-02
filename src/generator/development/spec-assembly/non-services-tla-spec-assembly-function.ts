import { SpecAssemblyFunction } from "./spec-assembly-function.js";

export const nonServiceTlaSpecAssemblyFunction: SpecAssemblyFunction = (
    developmentDockerComposeSpec,
    {
        serviceDockerComposeSpec
    }
) => {

    const nonServicesAttributeKeys = Object.keys(serviceDockerComposeSpec)
        .filter(attributeName => attributeName !== "services");

    for (const nonServicesAttribute of nonServicesAttributeKeys) {
        developmentDockerComposeSpec[nonServicesAttribute] = serviceDockerComposeSpec[nonServicesAttribute];
    }
};

export default nonServiceTlaSpecAssemblyFunction;
