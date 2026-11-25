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
     * Name of the env file, at the root of a repository, holding the
     * service's local environment variables
     */
    SERVICE_ENV_FILE: "chs-dev.env",

    /**
     * Names of the env files, at the root of the project, shared by all the
     * services. Listed in order of increasing precedence
     */
    DEFAULT_COMPOSE_ENV_FILES: ["global.env", ".env"],

    /**
     * ECS environments the service env can mimic: the repository (under the
     * ECS config folder) and the directory within it holding the env files
     */
    ECS_ENVIRONMENTS: {
        cidev: { repository: "ecs-service-configs-dev", directory: "development-eu-west-2/cidev" },
        staging: { repository: "ecs-service-configs-production", directory: "staging-eu-west-2/staging" },
        live: { repository: "ecs-service-configs-production", directory: "live-eu-west-2/live" }
    } as Record<string, { repository: string, directory: string }>,

    /**
     * ECS environment used when ECS_ENV is not set
     */
    DEFAULT_ECS_ENV: "cidev",

    /**
     * Folder, within the project, holding the clones of the ECS config
     * repositories, unless ECS_CONFIG_PATH is set
     */
    DEFAULT_ECS_CONFIG_PATH: "ecs-config",

    /**
     * Env file, within the ECS environment directory, shared by all services
     */
    ECS_GLOBAL_ENV_FILE: "global_vars.env",

    /**
     * Directory, within the project, for the generated compose files which
     * add the env files to the included services
     */
    ENV_OVERRIDES_DIRECTORY: "local/env-overrides",

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
    SHELL_CUSTOM_INIT_SCRIPT: "custom-init.sh"
};

export default CONSTANTS;
