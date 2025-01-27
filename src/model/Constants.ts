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
    DEFAULT_PERFORM_ECR_LOGIN_HOURS_THRESHOLD: 8,

    /**
     * The prefix for Companies House Java Package names
     */
    JAVA_BASE_PACKAGE: "uk.gov.companieshouse",

    /**
     * The default Spring Boot dependencies for a new service
     */
    SPRING_BOOT_DEPENDENCIES: [
        "web",
        "data-mongodb"
    ],

    /**
     * The URL for the Spring Initializr service
     */
    SPRING_BOOT_INITIALIZR_URL: "https://start.spring.io",

    /**
     * The Java version for a new service
     */
    JAVA_VERSION: "21",

    /**
     * The type of Spring Boot Java project for a new service
     */
    JAVA_PROJECT_TYPE: "maven-project",

    /**
     * The version of Spring Boot for a new service
     */
    SPRING_BOOT_VERSION: "3.3.5",

    /**
     * The name of the GitHub organisation for Companies House
     */
    COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME: "companieshouse",

    /**
     * The name of the repository for new service specs
     */
    NEW_SERVICE_SPECS_REPOSITORY_NAME: "proof-of-concept",

    /**
     * The branch of the repository for new service specs
     */
    NEW_SERVICE_SPECS_REPOSITORY_BRANCH: "feature/new-service-requests-concourse-based",

    /**
     * The path to the new service specs in the repository
     */
    NEW_SERVICE_SPECS_PATH: "repositories/",

    /**
     * Names of internal scrum teams
     */
    SCRUM_TEAMS: [
        "Aardvark",
        "Apollo",
        "Coblyn",
        "Element",
        "Parental Advisory",
        "Phoenix",
        "Spartacus",
        "Thundercats",
        "Titans",
        "Toro Loco"
    ],

    SERVICE_NAMES: [
        "Filing",
        "Incorporate",
        "Close"
    ]
};

export default CONSTANTS;
