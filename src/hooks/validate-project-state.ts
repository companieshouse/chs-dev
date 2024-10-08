import { Hook } from "@oclif/core";
import { existsSync } from "fs";
import load from "../helpers/config-loader.js";
import { join, relative } from "path";
import Config from "../model/Config.js";
import { hookFilter } from "./hook-filter.js";

/**
 * Validates the current project confirming that the files supplied in options
 * are present within the repository. If there are any missing it exits with an
 * error
 * @param options - containing the requiredFiles and potentially
 *  suggestionsOnFailure
 * @returns Promise representing the outcome of the operation
 */
export const hook: Hook<"validate-project-state"> = (options) => {

    if (!options.requiredFiles || typeof process.env.CHS_DEV_SKIP_PROJECT_STATE_VALIDATION !== "undefined") {
        return Promise.resolve();
    }

    if (hookFilter(options.id as string, options.argv as string[])) {

        const projectConfig = load();

        const anyMissing = findMissingFiles(options.requiredFiles, projectConfig);

        if (anyMissing.length > 0) {
            const suggestions = options.suggestionsOnFailure || [
                "Try again from a valid chs-dev project"
            ];

            options.context.error(
                `Not being run in a valid project: cannot find ${describeMissingFiles(anyMissing, projectConfig)} in project directory`,
                {
                    exit: 1,
                    code: "1",
                    ...{ suggestions }
                }
            );

            return Promise.reject(new Error("Not valid project"));
        }
    }
    return Promise.resolve();
};
function describeMissingFiles (anyMissing: string[], projectConfig: Config) {
    return anyMissing
        .map(missing => relative(projectConfig.projectPath, missing))
        .join(", ");
}

function findMissingFiles (requiredFiles: unknown, projectConfig: Config) {
    return (requiredFiles as string[])
        .map(requiredFile => join(projectConfig.projectPath, requiredFile))
        .filter(requiredFile => !existsSync(requiredFile));
}
