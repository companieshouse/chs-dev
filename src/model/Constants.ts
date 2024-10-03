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
     * Default value for the number of hours between ecr login checks
     */
    DEFAULT_PERFORM_ECR_LOGIN_HOURS_THRESHOLD: 8
};

export default CONSTANTS;
