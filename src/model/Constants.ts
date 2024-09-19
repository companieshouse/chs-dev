/**
 * Constant values for chs-dev projects
 */
export const CONSTANTS = {
    /**
     * The initial Docker Compose Spec which forms the basis of the generated
     * Docker Compose specification defining the environment
     */
    BASE_DOCKER_COMPOSE_FILE: "services/infrastructure/docker-compose.yaml",

    /**
     * Value for a boolean label to be considered true
     */
    BOOLEAN_LABEL_TRUE_VALUE: "true",

    /**
     * Path to the inventory of modules within the project
     */
    MODULES_DIRECTORY: "services/modules",

    /**
     * Defines placeholders used to reference different data items
     */
    templatePlaceHolders: {
        SERVICE_NAME: "<service>"
    }
};

export default CONSTANTS;
