type NewServiceSpec = {
    name: string,

    description: string

    type: {
        name: "MICROSERVICE",
        language: "JAVA" | "NODE"
    },

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
    },

    submission_details: {
        by: string,
        github_username: string
    },

    ownership: {
        team: string,

        service: string
    },

    sensitive: boolean,

    sensitivity_justification?: string
}

export default NewServiceSpec;
