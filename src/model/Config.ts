/**
 * Represents project configuration defining project related properties for
 * customising the behaviours of chs-dev
 */
export type Config = {

    /**
     * name to refer to the project/environment
     */
    readonly projectName: string;

    /**
     * path to the project repository
     */
    readonly projectPath: string;
    /**
     * additional environment variables for running the environment. Values can
     * contain 'file://' prefixes will try to read file in and set as value in
     * its place.
     */
    readonly env: Record<string, string>;

    /**
     * collection of Docker repositories in use by the project which require
     * authentication.
     */
    readonly authenticatedRepositories: string[];

    /**
     * when supplied defines the threshold for number of hours after which to
     * attempt ecr login
     */
    readonly performEcrLoginHoursThreshold?: number;

    /**
     * specifies the supported version of the CLI by the project
     */
    readonly versionSpecification?: string;

}

export default Config;
