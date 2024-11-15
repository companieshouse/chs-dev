import { Dirent, readdirSync, readFileSync } from "fs";
import { join } from "path";
import BuilderDockerComposeSpec from "../model/BuilderDockerComposeSpec.js";
import yaml from "yaml";

/**
 * Loads the requested version of the builder specification from the inventory
 * @param projectPath path to the project the tool is being run out of
 * @param builderName name of the builder being requested
 * @param version version of the builder being used
 * @returns BuilderDockerComposeSpec representing the builder
 */
export const getBuilder = (projectPath: string, builderName: string | undefined, version: string | undefined): BuilderDockerComposeSpec => {
    if (typeof builders === "undefined") {
        builders = {
            repository: {
                v1: {
                    name: "repository",
                    version: "v1",
                    builderSpec: repositoryBuilderSpec
                }
            }
        };

        populateBuildersCache(projectPath, builders);
    }

    if (typeof builderName === "undefined" || builderName.length === 0) {
        return getBuilder(projectPath, "repository", undefined);
    }

    if (!(builderName in builders)) {
        throw new Error(`No builder found for ${builderName} builder`);
    }

    const builderVersions = builders[builderName];

    const builderVersion = typeof version === "undefined"
        ? builderVersions[findLatestVersion(builderVersions)]
        : builderVersions[version];

    if (typeof builderVersion === "undefined") {
        throw new Error(`No version ${version} of ${builderName} builder`);
    }

    return builderVersion;
};

export const getBuilders = (projectPath: string) => {
    if (typeof builders === "undefined") {
        builders = {
            repository: {
                v1: {
                    name: "repository",
                    version: "v1",
                    builderSpec: repositoryBuilderSpec
                }
            }
        };

        populateBuildersCache(projectPath, builders);
    }

    return {
        ...builders
    };
};

export const clearBuilders = () => {
    builders = undefined;
};

const repositoryBuilderSpec = yaml.stringify({
    services: {
        "<service>": {
            pull_policy: "build",
            build: {
                context: "<absolute_repository_path>",
                args: {
                    // eslint-disable-next-line no-template-curly-in-string
                    SSH_PRIVATE_KEY: "${SSH_PRIVATE_KEY}",
                    // eslint-disable-next-line no-template-curly-in-string
                    SSH_PRIVATE_KEY_PASSPHRASE: "${SSH_PRIVATE_KEY_PASSPHRASE}"
                }
            },
            develop: {
                watch: [
                    {
                        path: ".touch",
                        action: "rebuild"
                    }
                ]
            }
        }
    }
});

let builders: undefined | Record<string, Record<string, BuilderDockerComposeSpec>>;

const isBuilderFile = (potentialBuilderFile: Dirent) => {
    return potentialBuilderFile.isFile() && (
        potentialBuilderFile.name === "builder.docker-compose.yaml" ||
        potentialBuilderFile.name === "builder.docker-compose.yml"
    );
};
const findLatestVersion = (builderVersions: Record<string, BuilderDockerComposeSpec>) => {
    return Object.keys(builderVersions).sort().reverse()[0];
};

const populateBuildersCache = (projectPath: string, builders: Record<string, Record<string, BuilderDockerComposeSpec>>) => {
    const buildersDir = join(projectPath, "local/builders");
    const buildersDirContents: Dirent[] = readdirSync(
        buildersDir, {
            recursive: true,
            withFileTypes: true
        }
    );

    const builderFiles = buildersDirContents.filter(isBuilderFile);

    for (const builder of builderFiles) {
        const pathWithoutBase = builder.parentPath.replace(
            `${buildersDir}/`, ""
        );

        const pathParts = pathWithoutBase.split("/");

        const spec = readFileSync(join(builder.parentPath, builder.name));

        if (typeof builders[pathParts[0]] === "undefined") {
            builders[pathParts[0]] = {};
        }

        builders[pathParts[0]][pathParts[1]] = {
            builderSpec: spec.toString(),
            name: pathParts[0],
            version: pathParts[1]
        };
    }
};
