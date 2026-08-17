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
     * The otel Docker Compose Spec
     */
    OTEL_DOCKER_COMPOSE_FILE: "services/infrastructure/open-telemetry/open-telemetry.docker-compose.yaml",

    /**
     * Value for a boolean label to be considered true
     */
    BOOLEAN_LABEL_TRUE_VALUE: "true",

    /**
     * Default value for the number of hours between ecr login checks
     */
    DEFAULT_PERFORM_ECR_LOGIN_HOURS_THRESHOLD: 8,

    /**
     * The name of the custom shell initialisation script
     */
    SHELL_CUSTOM_INIT_SCRIPT: "custom-init.sh",

    /**
     * The name of the keychain item used to store the SSH private key passphrase
     */
    SSH_PASSWORD_KEYCHAIN_ITEM_NAME: "ch-chs-dev:SSH_KEY_PASSPHRASE",

    /**
     * The name of the environment variable used to store the SSH private key passphrase
     */
    SSH_PASSWORD_ENV_VAR_NAME: "SSH_PRIVATE_KEY_PASSPHRASE",

    /**
     * The value to use when there is no SSH password
     */
    NO_SSH_PASSWORD_VALUE: "ch-chs-dev:SSH_KEY_PASSPHRASE:UNSET"
};

export default CONSTANTS;
