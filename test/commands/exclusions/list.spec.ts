import { expect, jest } from "@jest/globals";
import { Config } from "@oclif/core";
import List from "../../../src/commands/exclusions/list";

jest.mock("../../../src/state/state-manager", () => {
    return {
        StateManager: function () {
            return {
                snapshot: {
                    excludedServices: [
                        "ex-service-one",
                        "ex-service-two",
                        "ex-service-three"
                    ]
                }
            };
        }
    };
});

describe("exclusions list", () => {
    let exclusionsList;

    let logMock;
    let logJsonMock;
    let parseMock;

    beforeEach(() => {
        jest.resetAllMocks();

        exclusionsList = new List(
            [], {} as Config
        );

        logMock = jest.spyOn(exclusionsList, "log");
        logJsonMock = jest.spyOn(exclusionsList, "logJson");
        parseMock = jest.spyOn(exclusionsList, "parse");

        jest.spyOn(process, "cwd").mockReturnValue("./project");
    });

    it("logs all the current excluded services when json is false", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: false
            }
        });

        await exclusionsList.run();

        expect(logMock).toHaveBeenCalledTimes(4);
        expect(logMock).toHaveBeenCalledWith(" - ex-service-one");
        expect(logMock).toHaveBeenCalledWith(" - ex-service-two");
        expect(logMock).toHaveBeenCalledWith(" - ex-service-three");

        expect(logJsonMock).not.toHaveBeenCalled();
    });

    it("logs as json when json flag specified", async () => {
        parseMock.mockResolvedValue({
            flags: {
                json: true
            }
        });

        await exclusionsList.run();

        expect(logJsonMock).toHaveBeenCalledTimes(1);

        expect(logJsonMock).toHaveBeenCalledWith({
            exclusions: [
                "ex-service-one",
                "ex-service-two",
                "ex-service-three"
            ]
        });

        expect(logMock).not.toHaveBeenCalled();
    });
});
