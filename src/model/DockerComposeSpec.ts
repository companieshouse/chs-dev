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
        } & Record<string, any>
    }
};
