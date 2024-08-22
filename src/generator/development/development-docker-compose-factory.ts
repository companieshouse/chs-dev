import BuilderDockerComposeSpec from "../../model/BuilderDockerComposeSpec.js";
import { DockerComposeSpec } from "../../model/DockerComposeSpec.js";
import Service from "../../model/Service.js";
import applySpecAssemblyFunctions from "./spec-assembly/index.js";

/**
 * Factory class for producing Docker Compose Spec files for services to run
 * in development mode
 */
export default class DevelopmentDockerComposeSpecFactory {

    private readonly builderDockerComposeSpec: BuilderDockerComposeSpec;
    private readonly projectPath: string;

    constructor (
        builderDockerComposeSpec: BuilderDockerComposeSpec,
        projectPath: string
    ) {
        this.builderDockerComposeSpec = builderDockerComposeSpec;
        this.projectPath = projectPath;
    }

    /**
     * Creates a DockerComposeSpec representation of the supplied Service for
     * development mode
     * @param serviceDockerCompose the main specification for the service
     * @param service the service for which the new spec is being generated for
     * @returns generated DockerComposeSpec
     */
    create (
        serviceDockerCompose: DockerComposeSpec,
        service: Service
    ): DockerComposeSpec {
        const developmentDockerCompose = {
            services: {
                [service.name]: {}
            }
        };

        applySpecAssemblyFunctions(developmentDockerCompose, {
            service,
            projectPath: this.projectPath,
            serviceDockerComposeSpec: serviceDockerCompose,
            builderDockerComposeSpec: this.builderDockerComposeSpec
        });

        return developmentDockerCompose;
    }
}
