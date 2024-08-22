import BuilderDockerComposeSpec from "../../../model/BuilderDockerComposeSpec.js";
import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import Service from "../../../model/Service.js";

export type SpecAssemblyFunctionOptions = {
    projectPath: string,
    service: Service,
    serviceDockerComposeSpec: DockerComposeSpec,
    builderDockerComposeSpec: BuilderDockerComposeSpec
}

export type SpecAssemblyFunction = (developmentDockerComposeSpec: DockerComposeSpec, specAssemblyFunctionOptions: SpecAssemblyFunctionOptions) => void;
