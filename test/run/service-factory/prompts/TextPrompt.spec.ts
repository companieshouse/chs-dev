import { expect, jest } from "@jest/globals";
import TextPrompt from "../../../../src/run/service-factory/prompts/TextPrompt";
import { input as inputMock, confirm as confirmMock } from "../../../../src/helpers/user-input";

jest.mock("../../../../src/helpers/user-input");

describe("TextPrompt", () => {

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("calls input with the text provided", async () => {
        (inputMock as jest.Mock).mockResolvedValue("value" as never);

        const text = "text";

        const textPrompt = new TextPrompt(text, ".selector");

        const newServiceSpec = {};

        await textPrompt.make(newServiceSpec);

        expect(inputMock).toHaveBeenCalledWith(text);
    });

    it("returns the newServiceSpec with the value returned by input", async () => {
        const text = "text";

        const textPrompt = new TextPrompt(text, ".selector");

        const newServiceSpec = {};

        (inputMock as jest.Mock).mockResolvedValue("value" as never);

        await expect(textPrompt.make(newServiceSpec)).resolves.toEqual({
            selector: "value"
        });
    });

    it("asks for confirmation if already set", async () => {
        const text = "text";

        const textPrompt = new TextPrompt(text, ".name");

        const newServiceSpec = {
            name: "value"
        };

        (inputMock as jest.Mock).mockResolvedValue("value" as never);

        await textPrompt.make(newServiceSpec);

        expect(confirmMock).toHaveBeenCalledWith(`.name is already set to "value". Do you want to change it?`);
    });

    it("does not ask for confirmation if not already set", async () => {
        const text = "text";

        const textPrompt = new TextPrompt(text, ".name");

        const newServiceSpec = {};

        (inputMock as jest.Mock).mockResolvedValue("value" as never);

        await textPrompt.make(newServiceSpec);

        expect(confirmMock).not.toHaveBeenCalled();
    });

    it("returns the newServiceSpec without changing it if the user does not want to change it", async () => {
        const text = "text";

        const textPrompt = new TextPrompt(text, ".name");

        const newServiceSpec = {
            name: "value"
        };

        (confirmMock as jest.Mock).mockResolvedValue(false as never);

        await expect(textPrompt.make(newServiceSpec)).resolves.toEqual(newServiceSpec);

        expect(inputMock).not.toHaveBeenCalled();
    });

    it("prompts user for input if has value and user has confirmed they want to change it", async () => {
        const text = "text";

        const textPrompt = new TextPrompt(text, ".name");

        const newServiceSpec = {
            name: "value"
        };

        (confirmMock as jest.Mock).mockResolvedValue(true as never);
        (inputMock as jest.Mock).mockResolvedValue("new-value" as never);

        await textPrompt.make(newServiceSpec);

        expect(inputMock).toHaveBeenCalled();
    });

    it("throws error if user does not provide a response at all after 5 attempts", async () => {
        (inputMock as jest.Mock).mockResolvedValue("" as never);

        const textPrompt = new TextPrompt("Enter new value for name", ".name");

        const newServiceSpec = {
        };

        await expect(textPrompt.make(newServiceSpec)).rejects.toThrow("Invalid response to question: failed after 5 attempts");

        expect(inputMock).toHaveBeenCalledTimes(5);
    });

});
