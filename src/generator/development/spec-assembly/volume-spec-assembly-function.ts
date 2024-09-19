import { join } from "path";
import relativiseServicePath from "../utils/relativise-path.js";
import { SpecAssemblyFunction } from "./spec-assembly-function.js";

const BIND_DOCKER_COMPOSE_VOLUME_TYPE_VALUE = "bind";

const isVolumeBoundToLocalPath = (volume: Record<string, any>) =>
    volume.type === BIND_DOCKER_COMPOSE_VOLUME_TYPE_VALUE;

const relativiseVolume = (
    volume: string | Record<string, any>,
    source: string,
    destination: string
) => {
    if (typeof volume === "string") {
        const volumeParts = volume.split(":");

        return `${relativiseServicePath(
            volumeParts[0],
            source,
            destination
        )}:${volumeParts.slice(1).join(":")}`;
    } else {
        return isVolumeBoundToLocalPath(volume)
            ? {
                ...volume,
                source: relativiseServicePath(
                    volume.source,
                    source,
                    destination
                )
            }
            : volume;
    }
};

/**
 * SpecAssemblyFunction which will apply volumes and ensures any bound volumes
 * are relative to the new location
 * @param developmentDockerComposeSpec being constructed
 * @param options containing the service and serviceDockerComposeSpec
 */
export const volumeSpecAssemblyFunction: SpecAssemblyFunction = (
    developmentDockerComposeSpec,
    {
        serviceDockerComposeSpec,
        projectPath,
        service
    }
) => {
    const serviceVolumes = serviceDockerComposeSpec.services[service.name].volumes;

    if (typeof serviceVolumes !== "undefined") {
        const relativeServiceVolumes = serviceVolumes.map(
            (volume: string | Record<string, any>) => {
                return relativiseVolume(
                    volume,
                    service.source,
                    join(projectPath, "local", service.name)
                );
            }
        );

        developmentDockerComposeSpec.services[service.name].volumes = relativeServiceVolumes;
    }
};
