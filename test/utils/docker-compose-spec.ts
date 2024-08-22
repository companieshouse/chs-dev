import Service from "../../src/model/Service";
import yaml from "yaml";

export const generateServiceSpec = (service: Service): {
    services: Record<string, any>
} => {
    const optionalLabel = (
        labelKey: string, value: string | undefined | null
    ) => typeof value === "undefined" || value === null
        ? []
        : [`${labelKey}=${value}`];

    return {
        services: {
            [service.name]: {
                image: `12345678.ecr.eu-west-2.amazonaws.com/local/${service.name}:latest`,
                labels: [
                    ...optionalLabel("chs.local.builder", service.builder),
                    ...optionalLabel("chs.local.builder.languageVersion", service.metadata.languageMajorVersion),
                    ...optionalLabel("chs.repository.url", service.repository?.url),
                    ...optionalLabel("chs.repository.branch", service.repository?.branch),
                    ...optionalLabel("chs.local.repoContext", service.metadata.repoContext)
                ],
                environment: [
                    "ENV_VAR_ONE=one",
                    "ENV_VAR_TWO=one"
                ],
                networks: [
                    "chs"
                ],
                expose: [
                    8080
                ],
                healthcheck: {
                    test: "echo 1",
                    interval: "60s"
                },
                depends_on: service.dependsOn.reduce((prev, next) => ({
                    ...prev,
                    [next]: {
                        condition: "service_started"
                    }

                }), {})
            }
        }
    };
};

export const generateBuilderSpec = (builderPath: string, separateBuilder: boolean = true) => {
    const spec: {services: Record<string, Record<string, any>>} = { services: {} };

    if (separateBuilder) {
        spec.services["<service>-builder"] = {
            build: {
                dockerfile: `${builderPath}/build.Dockerfile`,
                context: "<chs_dev_root>"
            },
            volumes: [
                "<repository_path>:/app/",
                "./out:/opt/out"
            ],
            develop: {
                watch: [
                    {
                        path: ".touch",
                        action: "rebuild"
                    }
                ]
            }
        };
    }

    spec.services["<service>"] = {
        build: {
            dockerfile: `${builderPath}/Dockerfile`,
            context: "<chs_dev_root>"
        },
        volumes: [
            "<repository_path>/target:/opt/"
        ],
        ...(
            separateBuilder
                ? {
                    depends_on: {
                        "<service>-builder": {
                            condition: "service_completed_successfully",
                            restart: true
                        }
                    }
                }
                : {}
        )
    };

    return yaml.stringify(spec);
};
