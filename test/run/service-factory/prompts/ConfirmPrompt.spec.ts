import { expect, jest } from "@jest/globals";
import ConfirmPrompt from "../../../../src/run/service-factory/prompts/ConfirmPrompt";
import { confirm as confirmMock } from "../../../../src/helpers/user-input";
import NewServiceSpec from "../../../../src/model/NewServiceSpec";

jest.mock("../../../../src/helpers/user-input");

describe("ConfirmPrompt", () => {

    const confirmText = "confirm action?";
    const sensitiveSelector = ".sensitive";

    beforeEach(() => {
        jest.resetAllMocks();
    });

    const predicateThatReturns = (returnValue: boolean) =>
        jest.fn().mockReturnValue(returnValue) as (newServiceSpec: Partial<NewServiceSpec>) => boolean;

    it("calls confirm", async () => {
        (confirmMock as jest.Mock).mockResolvedValue(true as never);

        const confirmPrompt = new ConfirmPrompt(confirmText, sensitiveSelector);

        const newServiceSpec = {};

        await confirmPrompt.make(newServiceSpec);

        expect(confirmMock).toHaveBeenCalledWith(confirmText);
    });

    it("sets the value of the sensitive attribute to the value returned by confirm", async () => {
        (confirmMock as jest.Mock).mockResolvedValue(true as never);

        const confirmPrompt = new ConfirmPrompt(confirmText, sensitiveSelector);

        const newServiceSpec = {};

        await expect(confirmPrompt.make(newServiceSpec)).resolves.toEqual({
            sensitive: true
        });
    });

    it("does not call confirm when predicate returns false", () => {
        const predicate = predicateThatReturns(false);

        const confirmPrompt = new ConfirmPrompt(confirmText, sensitiveSelector, predicate);

        const newServiceSpec = {};

        confirmPrompt.make(newServiceSpec);

        expect(confirmMock).not.toHaveBeenCalled();
    });

    it("returns the newServiceSpec when predicate returns false", async () => {
        const predicate = predicateThatReturns(false);

        const confirmPrompt = new ConfirmPrompt(confirmText, sensitiveSelector, predicate);

        const newServiceSpec = {};

        await expect(confirmPrompt.make(newServiceSpec)).resolves.toEqual(newServiceSpec);
    });

    it("amends the newServiceSpec when predicate returns true", async () => {
        const predicate = predicateThatReturns(true);

        (confirmMock as jest.Mock).mockResolvedValueOnce(true as never).mockResolvedValue(false as never);

        const confirmPrompt = new ConfirmPrompt(confirmText, sensitiveSelector, predicate);

        const newServiceSpec = {
            sensitive: true
        };

        await expect(confirmPrompt.make(newServiceSpec)).resolves.toEqual({
            sensitive: false
        });
    });

    it("loops when confirm returns undefined", async () => {
        (confirmMock as jest.Mock).mockResolvedValueOnce(undefined as never).mockResolvedValue(true as never);

        const confirmPrompt = new ConfirmPrompt(confirmText, sensitiveSelector);

        const newServiceSpec = {};

        await confirmPrompt.make(newServiceSpec);

        expect(confirmMock).toHaveBeenCalledTimes(2);
    });

    it("asks for confirmation if already set", async () => {
        const confirmPrompt = new ConfirmPrompt(confirmText, sensitiveSelector);

        const newServiceSpec = {
            sensitive: true
        };

        (confirmMock as jest.Mock).mockResolvedValue(false as never);

        await confirmPrompt.make(newServiceSpec);

        expect(confirmMock).toHaveBeenCalledWith(`${sensitiveSelector} is already set to "true". Do you want to change it?`);
    });
});
