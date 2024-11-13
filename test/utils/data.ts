import Service from "../../src/model/Service";

export const services: Service[] = [
    {
        name: "service-one",
        description: "A Service for one and for all",
        module: "module-one",
        source: "services/modules/module-one/service-one.docker-compose.yaml",
        dependsOn: [],
        builder: "java",
        repository: {
            url: "git@github.com/companieshouse/repo-one.git"
        },
        metadata: {}
    },
    {
        name: "service-two",
        module: "module-one",
        source: "services/modules/module-one/service-two.docker-compose.yaml",
        dependsOn: ["service-one"],
        builder: "node",
        repository: {
            url: "git@github.com/companieshouse/repo2.git",
            branch: "develop"
        },
        metadata: {}
    },
    {
        name: "service-three",
        module: "module-one",
        source: "services/modules/module-one/service-three.docker-compose.yaml",
        dependsOn: ["service-one", "service-two"],
        builder: "",
        repository: null,
        metadata: {
            repoContext: "docker-env"
        }
    },
    {
        name: "service-four",
        module: "module-one",
        source: "services/modules/module-one/service-four.docker-compose.yaml",
        dependsOn: ["service-two", "service-one"],
        builder: "java",
        repository: {
            url: "git@github.com/companieshouse/repo-four.git"
        },
        metadata: {
            languageMajorVersion: "17"
        }
    },
    {
        name: "service-five",
        module: "module-two",
        source: "services/modules/module-two/service-five.docker-compose.yaml",
        dependsOn: ["service-four", "service-three", "service-two", "service-one"],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo-five.git"
        },
        metadata: {
            repoContext: "docker-env",
            dockerfile: "env.Dockerfile"
        }
    },
    {
        name: "service-six",
        module: "module-two",
        source: "services/modules/module-two/service-six.docker-compose.yaml",
        dependsOn: ["service-five", "service-four", "service-three", "service-two", "service-one"],
        builder: "node",
        repository: null,
        metadata: {
            languageMajorVersion: "18"
        }
    },
    {
        name: "service-seven",
        module: "module-two",
        source: "services/modules/module-two/service-seven.docker-compose.yaml",
        dependsOn: ["service-six", "service-five", "service-four", "service-three", "service-two", "service-one"],
        builder: "repository",
        repository: {
            url: "git@github.com/companieshouse/repo-seven.git"
        },
        metadata: {
            dockerfile: "env.Dockerfile"
        }
    },
    {
        name: "service-eight",
        module: "module-three",
        source: "services/modules/module-three/service-eight.docker-compose.yaml",
        dependsOn: ["service-three", "service-two", "service-one"],
        builder: "node",
        repository: {
            url: "git@github.com/companieshouse/repo-eight.git"
        },
        metadata: {
            languageMajorVersion: "20"
        }
    },
    {
        name: "service-nine",
        module: "module-three",
        source: "services/modules/module-three/service-nine.docker-compose.yaml",
        dependsOn: [],
        builder: "java-11",
        repository: {
            url: "git@github.com/companieshouse/repo-nine.git"
        },
        metadata: {
            languageMajorVersion: "21"
        }
    },
    {
        name: "service-ten",
        module: "module-three",
        source: "services/modules/module-three/service-ten.docker-compose.yaml",
        dependsOn: ["service-one"],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo-ten.git"
        },
        metadata: {}
    },
    {
        name: "service-eleven",
        module: "module-four",
        source: "services/modules/module-four/service-eleven.docker-compose.yaml",
        dependsOn: ["service-four", "service-three", "service-two", "service-one"],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo-eleven.git"
        },
        metadata: {}
    },
    {
        name: "service-twelve",
        module: "module-five",
        source: "services/modules/module-five/service-twelve.docker-compose.yaml",
        dependsOn: [],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo-eleven.git"
        },
        metadata: {}
    }
];

const deduplicate = (modules, next) => {
    const found = modules.find(module => module.name === next.name);

    if (!found) {
        modules.push(next);
    }

    return modules;
};

export const modules = services.map(({ module }) => ({ name: module })).reduce(deduplicate, []);
