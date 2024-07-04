import { beforeAll, expect, jest } from "@jest/globals";
import { Module } from "../../../src/model/Module";
import { Service } from "../../../src/model/Service";

import Services from "../../../src/commands/development/services";
import { Config } from "@oclif/core";

const services: Service[] = [
    {
        name: "service-one",
        description: "A Service for one and for all",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo.git"
        },
        metadata: {}
    },
    {
        name: "service-two",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: {
            url: "git@github.com/companieshouse/repo2.git",
            branch: "develop"
        },
        metadata: {}
    },
    {
        name: "service-three",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: null,
        metadata: {}
    },
    {
        name: "service-four",
        module: "module-one",
        source: "",
        dependsOn: [],
        builder: "",
        repository: null,
        metadata: {}
    }
];

const modules: Module[] = [
    {
        name: "module-one"
    }
];

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services,
                modules
            };
        }
    };
});

describe("development services", () => {
    const cwdSpy = jest.spyOn(process, "cwd");

    let developmentServices: Services;
    let parseMock;
    let logMock;
    let logJsonMock;

    beforeEach(() => {
        jest.resetAllMocks();

        cwdSpy.mockReturnValue("./docker-project");

        developmentServices = new Services(
            [], {
                cacheDir: "./cache"
            } as Config
        );

        // @ts-expect-error
        parseMock = jest.spyOn(developmentServices, "parse");

        logMock = jest.spyOn(developmentServices, "log");

        // @ts-expect-error
        logJsonMock = jest.spyOn(developmentServices, "logJson");
    });

    it("prints services when services called", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: false
            }
        });

        await developmentServices.run();

        expect(logMock).toHaveBeenCalledTimes(3);

        const logCalls = logMock.mock.calls;

        const expectedCalls = [
            "Available services:",
            ...services.filter(service => ["service-one", "service-two"].includes(service.name)).map(service => ` - ${service.name} (${service.description})`)
        ];

        expect(logCalls).toHaveLength(expectedCalls.length);

        for (let i = 0; i < expectedCalls.length; i++) {
            const expected = expectedCalls[i];
            const actual = logCalls[i];

            expect(actual).toEqual([expected]);
        }

        expect(logJsonMock).not.toHaveBeenCalled();
    });

    it("outputs services as json when json flag set", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: true
            }
        });

        await developmentServices.run();

        expect(logJsonMock).toHaveBeenCalledWith({
            services: [
                "service-one",
                "service-two"
            ]
        });

        expect(logMock).not.toHaveBeenCalled();
    });

});
