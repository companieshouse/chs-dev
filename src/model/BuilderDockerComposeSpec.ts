/**
 * Represents a Docker Compose specification for a builder
 */
export interface BuilderDockerComposeSpec {
    /**
     * Name of the builder
     */
    name: string;

    /**
     * Version of the builder
     */
    version: string;

    /**
     * String representation of the docker compose spec - may contain variables
     * in '< >' which are removed when the docker compose file is created
     */
    builderSpec: string;
}

export default BuilderDockerComposeSpec;
