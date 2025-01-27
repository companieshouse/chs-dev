import { expect, jest } from "@jest/globals";
import SelectPrompt from "../../../../src/run/service-factory/prompts/SelectPrompt.js";
import { confirm as confirmMock, input as inputMock } from "../../../../src/helpers/user-input.js";
import NewServiceSpec from "../../../../src/model/NewServiceSpec.js";

jest.mock("../../../../src/helpers/user-input");

describe("SelectPrompt", () => {

    beforeEach(() => {
        jest.resetAllMocks();
        (inputMock as jest.Mock).mockResolvedValue("value" as never);
    });

    it("calls select with the options provided", async () => {
        const options = [
            { value: "a" },
            { value: "b" },
            { value: "c" }
        ];

        const selectPrompt = new SelectPrompt("select", ".selector", options);

        const newServiceSpec = {};

        await selectPrompt.make(newServiceSpec);

        expect(inputMock).toHaveBeenCalledWith("select", {
            options
        });
    });

    it("calls select with the options provided by the function", async () => {
        const options = [
            { value: "a" },
            { value: "b" },
            { value: "c" }
        ];

        const optionsFunction = jest.fn().mockReturnValue(options);

        const selectPrompt = new SelectPrompt("select", ".selector", optionsFunction as (config: Record<string, any>) => { value: string }[]);

        const newServiceSpec = {};

        await selectPrompt.make(newServiceSpec);

        expect(optionsFunction).toHaveBeenCalledWith(newServiceSpec);
        expect(inputMock).toHaveBeenCalledWith("select", {
            options
        });
    });

    it("handles text attribute in options", async () => {
        const options = [
            { value: "a", text: "A" },
            { value: "b", text: "B" },
            { value: "c", text: "C" }
        ];

        const selectPrompt = new SelectPrompt("select", ".selector", options);

        const newServiceSpec = {};

        await selectPrompt.make(newServiceSpec);

        expect(inputMock).toHaveBeenCalledWith("select", {
            options: options.map(option => ({
                name: option.text,
                value: option.value
            }))
        });
    });

    it("adds the selected value to the newServiceSpec", async () => {
        const options = [
            { value: "a" },
            { value: "b" },
            { value: "c" }
        ];

        (inputMock as jest.Mock).mockResolvedValue("b" as never);

        const selectPrompt = new SelectPrompt("select", ".selector", options);

        const newServiceSpec = {};

        await expect(selectPrompt.make(newServiceSpec)).resolves.toEqual({
            selector: "b"
        });
    });

    it("asks for confirmation if already set", async () => {
        const options = [
            { value: "a" },
            { value: "b" },
            { value: "c" }
        ];

        const selectPrompt = new SelectPrompt("select", ".ownership.team", options);

        const newServiceSpec: Partial<NewServiceSpec> = {
            ownership: {
                team: "a",
                service: "b"
            }
        };

        await selectPrompt.make(newServiceSpec);

        expect(confirmMock).toHaveBeenCalledWith(`.ownership.team is already set to "a". Do you want to change it?`);
    });
});
