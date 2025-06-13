import { readFileSync } from "fs";
import { EOL } from "os";
import { join } from "path";
import yaml from "yaml";
import { getGeneratedDockerComposeFile } from "../helpers/docker-compose-file.js";
import CONSTANTS from "../model/Constants.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";
import { AbstractFileGenerator } from "./file-generator.js";

/**
 * OtelGenerator is responsible for modifying the generated Docker Compose file
 * to include or exclude OpenTelemetry (OTEL) services based on the provided flags.
 */
export class OtelGenerator extends AbstractFileGenerator {

    constructor (path: string) {
        super(path, "docker-compose.yaml");
    }

    /**
     * Modifies the generated Docker Compose file to include or exclude OpenTelemetry (OTEL) services based on the provided flags.
     *
     * @param flag - An object containing the OTEL flag and its negation.
     */
    modifyGeneratedDockerCompose (flag: Record<string, boolean> | undefined): void {
        const flagOption = Object.keys(flag || {});

        let generatedDockerCompose: DockerComposeSpec | undefined;

        if (flagOption.includes("otel")) {
            generatedDockerCompose = this.modifyIncludeProperties("add");
            generatedDockerCompose = this.modifyDependencies(generatedDockerCompose, "add");
        } else if (flagOption.includes("no-otel") || flagOption.length === 0) {
            generatedDockerCompose = this.modifyIncludeProperties("remove");
            generatedDockerCompose = this.modifyDependencies(generatedDockerCompose, "remove");
        }

        this.writeFile(
            yaml.stringify(generatedDockerCompose).split(EOL),
            EOL
        );
    }

    get otelServiceNames () {
        return Object.keys(this.getOtelServices()).filter(serviceName => serviceName !== "init");
    }

    private getOtelServices (): Record<string, any> {
        return yaml.parse(readFileSync(this.getOtelDockerComposeFilePath(), "utf8")).services;
    }

    private getOtelDockerComposeFilePath (): string {
        return join(this.path, CONSTANTS.OTEL_DOCKER_COMPOSE_FILE);
    }

    /**
     * Modifies the `include` property of the generated Docker Compose specification
     * by adding or removing the OTEL Docker Compose file path.
     *
     * @param action - "add" to include the OTEL Docker Compose file, "remove" to exclude it.
     * @returns {DockerComposeSpec} - The updated Docker Compose specification.
     */
    private modifyIncludeProperties (action: "add" | "remove"): DockerComposeSpec {
        const generatedDockerCompose = getGeneratedDockerComposeFile(this.path);
        const otelDockerComposeFilePath = this.getOtelDockerComposeFilePath();

        if (action === "add") {
            generatedDockerCompose.include = [
                otelDockerComposeFilePath,
                ...(generatedDockerCompose.include ?? []).filter(path => path !== otelDockerComposeFilePath)
            ];
        } else {
            generatedDockerCompose.include = generatedDockerCompose.include?.filter((path) => path !== otelDockerComposeFilePath) || [];
        }
        return generatedDockerCompose;
    }

    /**
     * Modifies the `depends_on` property of the generated Docker Compose specification
     * by adding or removing the OTEL services.
     *
     * @param action - "add" to include the OTEL services, "remove" to exclude it.
     * @returns {DockerComposeSpec} - The updated Docker Compose specification.
     */
    private modifyDependencies (generatedDockerCompose: DockerComposeSpec, action: "add" | "remove"): DockerComposeSpec {
        const otelServiceNames = this.otelServiceNames;

        const dependsOn = generatedDockerCompose.services["ingress-proxy"].depends_on || {};

        if (action === "add") {
            const otelIngressDependsOn = Object.fromEntries(
                otelServiceNames.map((serviceName) => [
                    serviceName,
                    {
                        condition: "service_started",
                        restart: true
                    }
                ])
            );
            generatedDockerCompose.services["ingress-proxy"].depends_on = {
                ...dependsOn,
                ...otelIngressDependsOn
            };
        } else {
            for (const serviceName of otelServiceNames) {
                delete dependsOn[serviceName];
            }
            generatedDockerCompose.services["ingress-proxy"].depends_on = dependsOn;
        }

        return generatedDockerCompose;
    }
}
