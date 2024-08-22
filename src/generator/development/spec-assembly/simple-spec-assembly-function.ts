import { SpecAssemblyFunction, SpecAssemblyFunctionOptions } from "./spec-assembly-function.js";

/**
 * A factory for producing SpecAssemblyFunctions which will copy the value
 * from the service spec across if it has been specified
 * @param serviceSpecPropertyName name of the property to copy across
 * @returns SpecAssemblyFunction for setting the property on the development
 *   service
 */
export const simpleSpecAssemblyFunctionFactory: (serviceSpecPropertyName: string) => SpecAssemblyFunction = (serviceSpecPropertyName: string) =>
    (developmentDockerComposeSpec, { serviceDockerComposeSpec, service }: SpecAssemblyFunctionOptions) => {

        const propertyValue = serviceDockerComposeSpec.services[service.name][serviceSpecPropertyName];

        if (typeof propertyValue !== "undefined") {
            developmentDockerComposeSpec.services[service.name][serviceSpecPropertyName] = propertyValue;
        }
    };
