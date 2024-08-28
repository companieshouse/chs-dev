import { basename, dirname, join, relative } from "path";
import { AbstractFileGenerator } from "./file-generator.js";
import { Service } from "../model/Service.js";
import yaml from "yaml";
import { EOL } from "os";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { deduplicate } from "../helpers/array-reducers.js";
import { getBuilder } from "../state/builders.js";
import DevelopmentDockerComposeSpecFactory from "./development/development-docker-compose-factory.js";
import getInitialDockerComposeFile from "../helpers/initial-docker-compose-file.js";

interface LiveUpdate {
  liveUpdate: boolean;
}

type ServiceWithLiveUpdate = Service & LiveUpdate;

export class DockerComposeFileGenerator extends AbstractFileGenerator {
    constructor (path: string) {
        super(path, "docker-compose.yaml");
    }

    generateDockerComposeFile (services: ServiceWithLiveUpdate[], excluded: string[] | undefined) {
        const dockerCompose = getInitialDockerComposeFile(this.path);

        // Remove any excluded services (if supplied)
        const runnableServices = typeof excluded !== "undefined"
            ? services.filter(service => !excluded.includes(service.name))
            : services;

        // Add all service files into the `include` attribute
        // handling any service which is in development mode
        dockerCompose.include = runnableServices.map(
            service => service.liveUpdate
                ? join(this.path, "local", service.name, "docker-compose.yaml")
                : service.source
        ).reduce(deduplicate, []);

        // Setup the ingress-proxy's dependencies (i.e. every service with an ingress route)
        dockerCompose.services["ingress-proxy"].depends_on = this.listIngressDependencies(runnableServices);

        this.writeFile(
            yaml.stringify(dockerCompose).split(EOL),
            EOL
        );
    }

    generateDevelopmentServiceDockerComposeFile (service: Service, builderVersion: string | undefined) {
        const developmentServicePath = join(this.path, "local", service.name);

        if (!existsSync(developmentServicePath)) {
            mkdirSync(developmentServicePath);
        }

        const developmentComposeFile = join("local", service.name, "docker-compose.yaml");
        const touchFileName = ".touch";
        const touchFile = join("local", service.name, touchFileName);

        const builderDockerComposeSpec = getBuilder(this.path, service.builder, builderVersion);
        const dockerComposeSpecFactory = new DevelopmentDockerComposeSpecFactory(
            builderDockerComposeSpec, this.path
        );

        const dockerComposeConfig = yaml.parse(readFileSync(service.source).toString("utf-8"));

        const developmentDockerComposeSpec = dockerComposeSpecFactory.create(
            dockerComposeConfig, service
        );

        // Create the development compose file and touch files
        this.writeFile(
            yaml.stringify(developmentDockerComposeSpec).split(EOL),
            EOL,
            developmentComposeFile
        );

        this.writeFile(
            [
                "Touching this file will trigger a rebuild of your service"
            ],
            EOL,
            touchFile
        );
    }

    private listIngressDependencies (services: ServiceWithLiveUpdate[]): Record<string, {condition: string, restart: boolean}> {
        return services
            .reduce((dependencySpec: Record<string, {condition: string, restart: boolean}>, service) => {
                // Selects services which have an ingressRoute defined
                if ((typeof service.metadata.ingressRoute !== "undefined" && service.metadata.ingressRoute !== null)) {
                    // Condition is selected based upon the presence of healthcheck - when present it will wait for
                    // the service to be healthy as opposed to just started
                    dependencySpec[service.name] = {
                        condition: (typeof service.metadata.healthcheck === "undefined" || service.metadata.healthcheck === null) ? "service_started" : "service_healthy",
                        restart: true
                    };
                }

                return dependencySpec;
            }, {});
    }
}
