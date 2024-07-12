import { expect, jest } from "@jest/globals";
import { services } from "../../utils/data";
import { Config } from "@oclif/core";
import Available from "../../../src/commands/services/available";

jest.mock("../../../src/state/inventory", () => {
    return {
        Inventory: function () {
            return {
                services
            };
        }
    };
});

describe("services available", () => {
    const cwdSpy = jest.spyOn(process, "cwd");

    let logMock;
    let logJsonMock;
    let parseMock;
    let servicesAvailable;

    beforeEach(() => {
        jest.resetAllMocks();

        cwdSpy.mockReturnValue("./project");

        servicesAvailable = new Available(
            [], {
                cacheDir: "./caches"
            } as Config
        );

        logMock = jest.spyOn(servicesAvailable, "log");
        logJsonMock = jest.spyOn(servicesAvailable, "logJson");
        parseMock = jest.spyOn(servicesAvailable, "parse");
    });

    it("prints out available services", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: false
            }
        });

        await servicesAvailable.run();

        expect(logMock).toHaveBeenCalledTimes(services.length + 1);
        expect(logMock).toHaveBeenCalledWith("Available services:");

        for (const service of services) {
            expect(logMock).toHaveBeenCalledWith(` - ${service.name}`);
        }

        expect(logJsonMock).not.toHaveBeenCalled();
    });

    it("outputs services as JSON when json flag set", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: true
            }
        });

        await servicesAvailable.run();

        expect(logJsonMock).toHaveBeenCalledWith({
            services: services.map(({ name }) => name).sort()
        });

        expect(logMock).not.toHaveBeenCalled();
    });
});
