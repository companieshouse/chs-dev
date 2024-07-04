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
    const logMock = jest.fn();

    let servicesAvailable;

    beforeEach(() => {
        jest.resetAllMocks();

        cwdSpy.mockReturnValue("./project");

        servicesAvailable = new Available(
            [], {
                cacheDir: "./caches"
            } as Config
        );

        servicesAvailable.log = logMock;
    });

    it("prints out available services", async () => {
        await servicesAvailable.run();

        expect(logMock).toHaveBeenCalledTimes(services.length + 1);
        expect(logMock).toHaveBeenCalledWith("Available services:");

        for (const service of services) {
            expect(logMock).toHaveBeenCalledWith(` - ${service.name}`);
        }
    });
});
