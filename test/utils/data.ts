export const services = [
    {
        name: "service-one",
        description: "A Service for one and for all",
        module: "module-one",
        source: "docker-project/services/modules/module-one/service-one.docker-compose.yaml",
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
        source: "docker-project/services/modules/module-one/service-two.docker-compose.yaml",
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
        source: "docker-project/services/modules/module-one/service-three.docker-compose.yaml",
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
        source: "docker-project/services/modules/module-one/service-four.docker-compose.yaml",
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
        source: "docker-project/services/modules/module-two/service-five.docker-compose.yaml",
        dependsOn: ["service-four", "service-three", "service-two", "service-one"],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo-five.git"
        },
        metadata: {
            repoContext: "docker-env",
            dockerFile: "env.Dockerfile"
        }
    },
    {
        name: "service-six",
        module: "module-two",
        source: "docker-project/services/modules/module-two/service-six.docker-compose.yaml",
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
        source: "docker-project/services/modules/module-two/service-seven.docker-compose.yaml",
        dependsOn: ["service-six", "service-five", "service-four", "service-three", "service-two", "service-one"],
        builder: "repository",
        repository: {
            url: "git@github.com/companieshouse/repo-seven.git"
        },
        metadata: {
            dockerFile: "env.Dockerfile"
        }
    },
    {
        name: "service-eight",
        module: "module-three",
        source: "docker-project/services/modules/module-three/service-eight.docker-compose.yaml",
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
        source: "docker-project/services/modules/module-three/service-nine.docker-compose.yaml",
        dependsOn: [],
        builder: "java",
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
        source: "docker-project/services/modules/module-three/service-ten.docker-compose.yaml",
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
        source: "docker-project/services/modules/module-four/service-eleven.docker-compose.yaml",
        dependsOn: ["service-four", "service-three", "service-two", "service-one"],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo-eleven.git"
        },
        metadata: {}
    }
];

export const modules = services.map(({ module }) => ({ name: module }));
