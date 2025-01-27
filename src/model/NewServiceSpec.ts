/**
 * Defines the names of the types of services that can be created.
 */
type ServiceTypeName = "MICROSERVICE";

/**
 * Defines the names of the languages that can be used to create a service.
 */
type LanguageName = "JAVA" | "NODE";

/**
 * Defines the type of a new service specification.
 */
type NewServiceSpecType = {
    name: ServiceTypeName,
    language: LanguageName
}

/**
 * A specification for a new service.
 */
type NewServiceSpec = {
    /**
     * The name of the service.
     */
    name: string,

    /**
     * A description of the service.
     */
    description: string

    /**
     * The type of the service. also defines the language of the service.
     */
    type: NewServiceSpecType,

    /**
     * The configuration for the service - this can contain any number of keys and values.
     * The keys and values are defined by the service type and its deployment configuration.
     */
    configuration: {
        java?: {
            spring_initializr_url: string
        },
        ["docker-chs-development"]?: {
            module: string
        },
        deploy?: {
            stack_name: string
        }
    } | Record<string, any>,

    /**
     * Details about who has submitted the service
     */
    submission_details: {
        by: string,
        github_username: string
    },

    /**
     * Ownership details for the service
     */
    ownership: {
        /**
         * Name of the development team responsible for the service
         */
        team: string,

        /**
         * Name of the service which owns the service
         */
        service: string
    },

    /**
     * Whether the service is sensitive or not
     */
    sensitive: boolean,

    /**
     * When the service is sensitive, a justification must be provided
     */
    sensitivity_justification?: string
}

export default NewServiceSpec;
