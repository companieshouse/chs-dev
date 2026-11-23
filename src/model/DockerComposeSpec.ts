type Secret = {
    environment: string
} | {
    file: string
}

/**
 * An entry of the top level `include` property: either the path to a compose
 * file or the long syntax, which allows listing override files and the env
 * files used to interpolate the included files
 */
export type IncludeEntry = string | {
    path: string | string[],
    env_file?: string[],
    project_directory?: string
};

/**
 * Represents the Docker Compose Spec file when read in from yaml
 */
export type DockerComposeSpec = {
    services: {
        [serviceName: string] : {
            labels?: string[] | Record<string, string>,
            environment?: string[] | Record<string, string>,
            image?: string,
            build?: Record<string, any>,
            env_file?: string | string[],
            depends_on?: string[] | Record<string, Record<string, any>>
            secrets?: string[] | Record<string, any>,
            ports?: string | string[]
        } & Record<string, any>
    },
    secrets?: Record<string, Secret>,
    include?: IncludeEntry[],
    networks?: Record<string, any>,
    volumes?: Record<string, any>
};
