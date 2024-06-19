import { jest, expect } from "@jest/globals";
import { Module, Service } from "../../src/state/inventory";
import { State } from "../../src/state/state-manager";
import Status from "../../src/commands/status";
import { Config } from "@oclif/core";

const services: Service[] = [
    {
        name: "service-one",
        module: "module-two",
        source: "",
        dependsOn: [
            "service-five"
        ],
        builder: "",
        metadata: {},
        repository: null
    },
    {
        name: "service-two",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        metadata: {},
        repository: null
    },
    {
        name: "service-three",
        module: "module-two",
        source: "",
        dependsOn: [],
        builder: "",
        metadata: {},
        repository: null
    },
    {
        name: "service-four",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        metadata: {},
        repository: null
    },
    {
        name: "service-five",
        module: "module-three",
        source: "",
        dependsOn: [],
        builder: "",
        metadata: {},
        repository: null
    }
];
const modules: Module[] = [{
    name: "module-one"
}, {
    name: "module-two"
}];
const snapshot: State = {
    modules: [
        "module-one"
    ],
    services: [
        "service-one",
        "service-two"
    ],
    servicesWithLiveUpdate: [
        "service-two"
    ],
    excludedFiles: [
        "service-three"
    ]
};

const getServiceStatusesMock = jest.fn();

jest.mock("../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services,
                modules
            };
        }
    };
});

jest.mock("../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return { snapshot };
        }
    };
});

jest.mock("../../src/run/docker-compose", () => {
    return {
        DockerCompose: function () {
            return {
                getServiceStatuses: getServiceStatusesMock
            };
        }
    };
});

describe("Status command", () => {
    let status: Status;
    let testConfig: Config;
    let logMock;
    let runHookMock;

    beforeEach(() => {
        jest.resetAllMocks();

        const cwdSpy = jest.spyOn(process, "cwd");
        cwdSpy.mockReturnValue("/users/user/docker-chs/");

        runHookMock = jest.fn();
        logMock = jest.fn();

        // @ts-expect-error
        testConfig = { root: "./", configDir: "./config", cacheDir: "./cache", runHook: runHookMock };

        status = new Status([], testConfig);
        status.log = logMock;
    });

    it("should log without docker compose statuses", async () => {
        await status.run();

        expect(logMock).toHaveBeenCalledTimes(12);

        expect(logMock.mock.calls).toMatchSnapshot();
    });

    it("should log with their docker compose statuses", async () => {
        getServiceStatusesMock.mockReturnValue({
            "service-one": "running",
            "service-two": "running",
            "service-five": "stopped",
            "service-four": "stopped"
        });

        await status.run();

        expect(logMock).toHaveBeenCalledTimes(12);

        expect(logMock.mock.calls).toMatchSnapshot();
    });
});
