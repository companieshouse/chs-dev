import { expect, jest } from "@jest/globals";
import Module from "../../src/model/Module";
import Service from "../../src/model/Service";
import State from "../../src/model/State";
import { deduplicate } from "../../src/helpers/array-reducers";
import { Inventory } from "../../src/state/inventory";
import { ServiceLoader } from "../../src/run/service-loader";

const serviceOne = {
    name: "service-one",
    module: "module-one",
    source: "./module-one/service-one.docker-compose.yaml",
    dependsOn: [],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceTwoTilt = {
    name: "service-two",
    module: "module-one",
    source: "./module-one/tilt/service-two.docker-compose.yaml",
    dependsOn: ["service-one"],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceTwo = {
    name: "service-two",
    module: "module-one",
    source: "./module-one/service-two.docker-compose.yaml",
    dependsOn: ["service-one"],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceThree = {
    name: "service-three",
    module: "module-one",
    source: "./module-one/service-three.docker-compose.yaml",
    dependsOn: ["service-one"],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceFour = {
    name: "service-four",
    module: "module-two",
    source: "./module-two/service-four.docker-compose.yaml",
    dependsOn: ["service-one", "service-two", "service-three"],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceFive = {
    name: "service-five",
    module: "module-two",
    source: "./module-two/service-five.docker-compose.yaml",
    dependsOn: ["service-one", "service-two", "service-three", "service-four"],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceSix = {
    name: "service-six",
    module: "module-two",
    source: "./module-two/service-six.docker-compose.yaml",
    dependsOn: [
        "service-one",
        "service-two",
        "service-three",
        "service-four",
        "service-five"
    ],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceSeven = {
    name: "service-seven",
    module: "module-three",
    source: "./module-three/service-seven.docker-compose.yaml",
    dependsOn: [
        "service-one",
        "service-two",
        "service-three",
        "service-four",
        "service-five",
        "service-six"
    ],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceEight = {
    name: "service-eight",
    module: "module-three",
    source: "./module-three/service-eight.docker-compose.yaml",
    dependsOn: [
        "service-one",
        "service-two",
        "service-three",
        "service-four",
        "service-five",
        "service-six",
        "service-seven"
    ],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceNine = {
    name: "service-nine",
    module: "module-three",
    source: "./module-three/service-seven.docker-compose.yaml",
    dependsOn: [
        "service-one",
        "service-two",
        "service-three",
        "service-four",
        "service-five",
        "service-six",
        "service-seven",
        "service-eight",
        "service-eleven"
    ],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceTen = {
    name: "service-ten",
    module: "module-four",
    source: "./module-four/service-ten.docker-compose.yaml",
    dependsOn: [],
    repository: null,
    builder: "",
    metadata: {}
};

const serviceTenTilt = {
    name: "service-ten",
    module: "module-four",
    source: "./module-four/tilt/service-ten.docker-compose.yaml",
    dependsOn: [],
    repository: null,
    builder: "",
    metadata: {}
};

const services: Service[] = [
    serviceOne,
    serviceTwoTilt,
    serviceTwo,
    serviceThree,
    serviceFour,
    serviceFive,
    serviceSix,
    serviceSeven,
    serviceEight,
    serviceNine,
    serviceTen,
    serviceTenTilt
];

const modules: Module[] = services.map(service => service.module)
    .reduce(deduplicate, [])
    .map(modName => ({ name: modName }));

const inventory = {
    services,
    modules
} as Inventory;

describe("ServiceLoader", () => {

    const serviceLoader = new ServiceLoader(inventory);
    let state: State;

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("loads services correctly when all services enabled, none in dev mode", () => {
        state = {
            services: [
                "service-three",
                "service-two"
            ],
            modules: [],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };

        const result = serviceLoader.loadServices(state);

        expect(result).toMatchSnapshot();
    });

    it("loads modules, no services enabled, none in dev mode", () => {
        state = {
            services: [],
            modules: ["module-three"],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };

        const result = serviceLoader.loadServices(state);

        expect(result).toMatchSnapshot();
    });

    it("loads module and service, none in dev mode", () => {
        state = {
            services: ["service-four"],
            modules: ["module-four"],
            servicesWithLiveUpdate: [],
            excludedServices: []
        };

        const result = serviceLoader.loadServices(state);

        expect(result).toMatchSnapshot();
    });

    it("loads services in dev mode", () => {
        state = {
            services: ["service-four"],
            modules: ["module-four"],
            servicesWithLiveUpdate: ["service-four", "service-ten"],
            excludedServices: []
        };

        const result = serviceLoader.loadServices(state);

        expect(result).toMatchSnapshot();
    });

    it("does not load a transient service in dev mode", async () => {
        state = {
            services: [],
            modules: ["module-three"],
            servicesWithLiveUpdate: ["service-four"],
            excludedServices: []
        };

        const result = serviceLoader.loadServices(state);

        expect(result).toMatchSnapshot();

    });
});
