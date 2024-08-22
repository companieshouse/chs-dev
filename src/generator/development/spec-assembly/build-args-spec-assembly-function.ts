import Service from "../../../model/Service.js";
import { SpecAssemblyFunction } from "./spec-assembly-function.js";

type BuildArgApplicationFunction = (service: Service, composeServiceName: string, serviceSpec: {
    build?: Record<string, any>
}) => void

/**
 * Constructs a function which can handle the supplied build argument defined
 * by the argName parameter and will set its value when it is set on the input
 * spec
 * @param argName name of the build argument being set
 * @param valueSupplier function capable of supplying the value of the build
 *  arg from the service supplied
 * @returns function capable of setting args on the serviceSpec
 */
const buildArgApplicationFunctionFactory = (argName: string, valueSupplier: (service: Service) => string | undefined | null) => {
    return (service: Service, _: string, serviceSpec: {build?: Record<string, any>}) => {
        const value = valueSupplier(service);

        if (value !== null && typeof value !== "undefined" && typeof serviceSpec.build !== "undefined") {
            if (typeof serviceSpec.build.args === "undefined") {
                serviceSpec.build.args = {};
            }

            serviceSpec.build.args[argName] = value;
        }
    };
};

const buildArgApplicationFunctions: BuildArgApplicationFunction[] = [
    buildArgApplicationFunctionFactory("LANGUAGE_MAJOR_VERSION", service => service.metadata.languageMajorVersion),
    buildArgApplicationFunctionFactory("ENTRYPOINT", service => service.metadata.entrypoint),
    buildArgApplicationFunctionFactory("OUTDIR", service => service.metadata.buildOutputDir)
];

/**
 * A SpecAssemblyFunction for applying build args to the service specs within
 * the development docker compose spec file
 * @param developmentDockerComposeSpec spec file under construction
 * @param specAssemblyFunctionOptions SpecAssemblyFunctionOptions defining the
 *  options for assembling the spec
 */
const buildArgsSpecAssemblyFunction: SpecAssemblyFunction = (developmentDockerComposeSpec, {
    service
}) => {
    for (const serviceName of Object.keys(developmentDockerComposeSpec.services)) {
        buildArgApplicationFunctions.forEach(applicatorFunction => applicatorFunction(service, serviceName, developmentDockerComposeSpec.services[serviceName]));
    }
};

export default buildArgsSpecAssemblyFunction;
