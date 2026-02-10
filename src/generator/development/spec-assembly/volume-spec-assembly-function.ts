import { join, isAbsolute, sep } from "path";
import relativiseServicePath from "../utils/relativise-path.js";
import { SpecAssemblyFunction } from "./spec-assembly-function.js";

const BIND_DOCKER_COMPOSE_VOLUME_TYPE_VALUE = "bind";

const isVolumeBoundToLocalPath = (volume: Record<string, any>) =>
    volume.type === BIND_DOCKER_COMPOSE_VOLUME_TYPE_VALUE;

/**
 * Determines whether a volume source should be treated as a relative path.
 * Absolute paths and named volumes are not considered relative.
 * @param volumeSource string value representing the volume source
 * @returns true when the source represents a relative filesystem path
 */
const isRelativePath = (volumeSource: string) => {
    if (isAbsolute(volumeSource)) {
        return false;
    }

    if (volumeSource.startsWith(".")) {
        return true;
    }

    return volumeSource.includes(sep) || volumeSource.includes("/");
};

/**
 * Extracts the target path from a short or long volume definition.
 * @param volume volume definition in short or long format
 * @returns target path when present, otherwise undefined
 */
const getVolumeTarget = (volume: string | Record<string, any>) => {
    if (typeof volume === "string") {
        const volumeParts = volume.split(":");
        return volumeParts.length >= 2 ? volumeParts[1] : undefined;
    }

    return volume.target as string | undefined;
};

/**
 * Relativises a short-form volume string when the source is a relative path.
 * @param volume short-form volume (source:target[:mode])
 * @param source original compose file location
 * @param destination generated compose directory
 * @returns updated volume string with relative source when applicable
 */
const relativiseShortVolume = (
    volume: string,
    source: string,
    destination: string
) => {
    const volumeParts = volume.split(":");
    const volumeSource = volumeParts[0];

    if (!isRelativePath(volumeSource)) {
        return volume;
    }

    return `${relativiseServicePath(
        volumeSource,
        source,
        destination
    )}:${volumeParts.slice(1).join(":")}`;
};

const relativiseVolume = (
    volume: string | Record<string, any>,
    source: string,
    destination: string
) => {
    if (typeof volume === "string") {
        return relativiseShortVolume(volume, source, destination);
    }

    if (!isVolumeBoundToLocalPath(volume)) {
        return volume;
    }

    const volumeSource = volume.source as string;

    if (!isRelativePath(volumeSource)) {
        return volume;
    }

    return {
        ...volume,
        source: relativiseServicePath(
            volumeSource,
            source,
            destination
        )
    };
};

/**
 * Merges builder and service volumes, allowing service volumes to override
 * builder volumes when they share the same target.
 * @param builderVolumes volumes injected by the builder spec
 * @param serviceVolumes volumes from the service spec
 * @returns merged list of volumes with service overrides applied
 */
const mergeVolumes = (
    builderVolumes: Array<string | Record<string, any>>,
    serviceVolumes: Array<string | Record<string, any>>
) => {
    if (!builderVolumes.length) {
        return serviceVolumes;
    }

    if (!serviceVolumes.length) {
        return builderVolumes;
    }

    const overriddenTargets = new Set(
        serviceVolumes
            .map(getVolumeTarget)
            .filter((target): target is string => typeof target === "string")
    );

    const filteredBuilderVolumes = builderVolumes.filter(volume => {
        const target = getVolumeTarget(volume);
        return typeof target === "undefined" || !overriddenTargets.has(target);
    });

    const deduped = new Map<string, string | Record<string, any>>();

    [...filteredBuilderVolumes, ...serviceVolumes].forEach(volume => {
        const key = typeof volume === "string" ? volume : JSON.stringify(volume);
        deduped.set(key, volume);
    });

    return Array.from(deduped.values());
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
    const builderVolumes = developmentDockerComposeSpec.services[service.name].volumes ?? [];

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

        developmentDockerComposeSpec.services[service.name].volumes = mergeVolumes(
            builderVolumes,
            relativeServiceVolumes
        );
    } else if (builderVolumes.length) {
        developmentDockerComposeSpec.services[service.name].volumes = builderVolumes;
    }
};
