import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import { SpecAssemblyFunction } from "./spec-assembly-function.js";

const serviceSpecWithoutMutableFields = (serviceSpec: DockerComposeSpec, serviceName: string, mutableFields: string[]) => {
    return Object.entries(serviceSpec.services[serviceName])
        .filter(([serviceKey, _]) => !mutableFields.includes(serviceKey))
        .reduce((previous, [serviceKey, value]) => ({
            ...previous,
            [serviceKey]: value
        }), {});
};

/**
 * Creates a SpecAssemblyFunction which will apply any field present in the
 * service which are not part of the supplied list of mutable fields (i.e.
 * those fields mutated/modified by the spec assembly functions.)
 * @param mutableFields list of fields which may or may not be present in the
 *      source service which are modified by other SpecAssemblyFunctions
 * @returns SpecAssemblyFunction capable of copying across any field from the
 *      input service spec to the spec being generated which are not mutated
 */
export const immutableServiceFieldsSpecAssemblyFunction: (mutableFields: string[]) => SpecAssemblyFunction = (mutableFields: string[]) => (
    developmentDockerComposeSpec,
    {
        serviceDockerComposeSpec,
        service
    }
) => {
    developmentDockerComposeSpec.services[service.name] = serviceSpecWithoutMutableFields(
        serviceDockerComposeSpec,
        service.name,
        mutableFields
    );
};
