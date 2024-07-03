import { basename, dirname, join, relative } from "path";
import { AbstractFileGenerator } from "./file-generator.js";
import { Service } from "../model/Service.js";
import yaml from "yaml";
import { EOL } from "os";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { deduplicate } from "../helpers/array-reducers.js";

interface LiveUpdate {
  liveUpdate: boolean;
}

type ServiceWithLiveUpdate = Service & LiveUpdate;

export class DockerComposeFileGenerator extends AbstractFileGenerator {
    constructor (path: string) {
        super(path, "docker-compose.yaml");
    }

    generateDockerComposeFile (services: ServiceWithLiveUpdate[], excluded: string[] | undefined) {
        const initialDockerComposeFile = join(this.path, "services/infrastructure/docker-compose.yaml");

        const dockerCompose = yaml.parse(readFileSync(initialDockerComposeFile).toString("utf-8"));

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

    generateDevelopmentServiceDockerComposeFile (service: Service) {
        const developmentServicePath = join(this.path, "local", service.name);

        if (!existsSync(developmentServicePath)) {
            mkdirSync(developmentServicePath);
        }

        const developmentComposeFile = join("local", service.name, "docker-compose.yaml");
        const touchFileName = ".touch";
        const touchFile = join("local", service.name, touchFileName);

        const dockerComposeConfig = yaml.parse(readFileSync(service.source).toString("utf-8"));

        // Sets up the output docker compose file with the configuration which watches for changes
        // to the touch file (i.e. watch configuration)
        dockerComposeConfig.services[service.name].develop = {
            watch: [{
                path: touchFileName,
                action: "rebuild"
            }]
        };

        dockerComposeConfig.services[service.name].env_file =
            this.formatEnvFileForDevelopmentMode(
                service.source,
                service.name,
                dockerComposeConfig
            );

        // Sets up the output docker compose file with the build information
        if (service.builder === "repository" || service.builder === "") {
            // When builder should be the repository setup the build instructions to
            // point to the repository
            const repositoryContext = service.metadata.repoContext || "";
            const dockerfile = service.metadata.dockerfile ? { dockerfile: service.metadata.dockerfile } : {};

            dockerComposeConfig.services[service.name].build = {
                ...dockerfile,
                context: join(this.path, "repositories", service.name, repositoryContext)
            };
        } else {
            // The docker compose file has a builder label therefore use builder
            dockerComposeConfig.services[service.name].build = {
                dockerfile: join(this.path, "local/builders", service.builder, "Dockerfile"),
                context: this.path,
                args: {
                    ...this.optionalBuildArg("LANGUAGE_MAJOR_VERSION", service.metadata.languageMajorVersion),
                    ...this.optionalBuildArg("ENTRYPOINT", service.metadata.entrypoint),
                    ...this.optionalBuildArg("OUTDIR", service.metadata.buildOutputDir),
                    REPO_PATH: join(this.path, "repositories", service.name)
                }
            };
        }

        // Create the development compose file and touch files
        this.writeFile(
            yaml.stringify(dockerComposeConfig).split(EOL),
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

    private optionalBuildArg (name: string, value: string | null | undefined) {
        const buildArg: Record<string, string> = {};

        if (value) {
            buildArg[name] = value;
        }

        return buildArg;
    }

    private formatEnvFileForDevelopmentMode (source: string, serviceName: string, dockerComposeConfig: Record<string, any>): any {
        const envFile = dockerComposeConfig.services[serviceName].env_file;

        if (typeof envFile === "string") {
            return this.formatEnvFileValue(source, serviceName, envFile);
        }

        if (Array.isArray(envFile)) {
            return envFile.map(envFileValue => this.formatEnvFileValue(source, serviceName, envFileValue));
        }

        return envFile;
    }

    private formatEnvFileValue (source: string, serviceName: string, envFileValue: string) {
        const relativePathToSource = relative(join(this.path, "local", serviceName), source);

        return join(dirname(relativePathToSource), envFileValue);
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
