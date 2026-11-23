import { IncludeEntry } from "../model/DockerComposeSpec.js";

/**
 * Gets the path of the compose file an include entry refers to (the first one
 * when the entry lists overrides too)
 */
export const getIncludePath = (entry: IncludeEntry): string => {
    if (typeof entry === "string") {
        return entry;
    }

    return Array.isArray(entry.path) ? entry.path[0] : entry.path;
};
