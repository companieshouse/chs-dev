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

export const createCompleteServiceSpecForServiceWithName = (serviceName: string) => ({
    services: {
        [serviceName]: {
            image: "123456789.ecr.eu-west-2.com/" + serviceName,
            annotations: [
                "one:two"
            ],
            attach: false,
            build: {
                dockerfile: "../Dockerfile"
            },
            blkio_config: {
                weight: 400
            },
            cpu_count: 1,
            cpu_percent: 20,
            cpu_shares: 1,
            cpu_period: 34,
            cpu_quota: 1,
            cpu_rt_runtime: "400ms",
            cpu_rt_period: "400ms",
            cpus: 0.123,
            cpuset: 3,
            cap_add: [
                "ALL"
            ],
            cap_drop: [
                "NET_ADMIN"
            ],
            cgroup: "private",
            cgroup_parent: "ingress",
            command: "which java",
            configs: [
                "config-one"
            ],
            container_name: "my-container",
            credential_spec: {
                file: "my-cred-spec.json"
            },
            depends_on: [
                "service-5"
            ],
            deploy: {},
            develop: {
                watch: "my-file"
            },
            device_cgroup_rules: [
                "c 1:3 mr"
            ],
            devices: [
                "/dev/ttyUSB0:/dev/ttyUSB0"
            ],
            dns: [
                "8.8.8.8"
            ],
            dns_opt: [
                "use-vpc"
            ],
            dns_search: [
                "dc.example.com"
            ],
            domainname: "hellworld.com",
            driver_opts: {
                optOne: "123456"
            },
            entrypoint: "echo",
            env_file: "my-env.env",
            environment: {
                ONE: "FOO",
                TWO: "BAR"
            },
            expose: 8998,
            external_links: [
                "redis"
            ],
            extra_hosts: [
                "hello.local=234.359.4567"
            ],
            group_add: [
                "mail"
            ],
            healthcheck: {
                test: "echo 1"
            },
            hostname: "hello.local",
            init: true,
            ipc: "shareable",
            isolation: "fp",
            labels: [
                "label.one=foo",
                "label.two=bar"
            ],
            links: [
                "db"
            ],
            logging: {
                driver: "syslog"
            },
            mem_limit: "1024",
            mem_reservation: "2048",
            mem_swappiness: 50,
            memswap_limit: "300m",
            network_mode: "host",
            networks: [
                "network-one"
            ],
            oom_kill_disable: true,
            oom_score_adj: 400,
            pid: 2345,
            pids_limit: 20,
            platform: "darwin",
            ports: [
                "9090:9090"
            ],
            privileged: true,
            profiles: [
                "frontend"
            ],
            pull_policy: "missing",
            read_only: true,
            restart: "always",
            runtime: "another",
            scale: {},
            secrets: [
                "one"
            ],
            security_opt: [
                "label:user:USER"
            ],
            shm_size: "3094b",
            stdin_open: false,
            stop_grace_period: "1m30s",
            stop_signal: "SIGUSR1",
            storage_opt: {
                size: "1G"
            },
            sysctls: {
                "net.core.somaxconn": 1024
            },
            tmpfs: "/run",
            tty: false,
            ulimits: {
                nproc: 65535
            },
            user: "fred-flintstone",
            userns_mode: "host",
            uts: "host",
            volumes: [
                "my-vol:/var/vol/"
            ],
            volumes_from: [
                "service-for"
            ],
            working_dir: "/opt/app/one-two-three"
        }
    }
});
