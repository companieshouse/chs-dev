import { expect, jest } from "@jest/globals";

import { confirm as confirmMock, input as inputMock, select as selectMock, editor as editorMock } from "@inquirer/prompts";
import { confirm, input, editor } from "../../src/helpers/user-input";

jest.mock("@inquirer/prompts");

describe("confirm", () => {
    const question = "Confirm this action please";

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("calls inquirer confirm with message and no default when not set", async () => {
        await confirm(
            question
        );

        expect(confirmMock).toHaveBeenCalledWith({
            message: question
        });
    });

    it("calls inquirer confirm with message and default when set", async () => {
        await confirm(
            question,
            {
                defaultValue: false
            }
        );

        expect(confirmMock).toHaveBeenCalledWith({
            message: question,
            default: false
        });
    });

    it("responds with value from inquirer", async () => {
        // @ts-expect-error
        confirmMock.mockResolvedValue(true);

        await expect(confirm(question)).resolves.toBe(true);
    });
});

describe("input with no options", () => {

    const question = "Enter a value please";

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("can provide default value", async () => {
        await input(
            question,
            {
                defaultValue: "default"
            }
        );

        expect(inputMock).toHaveBeenCalledWith({
            message: question,
            default: "default"
        });
    });

    it("calls inquirer prompt with message and no default when not set", async () => {
        await input(
            question
        );

        expect(inputMock).toHaveBeenCalledWith({
            message: question
        });
    });

    it("calls inquirer confirm with message and default when set", async () => {
        await input(
            question,
            {
                defaultValue: "defaultValue"
            }
        );

        expect(inputMock).toHaveBeenCalledWith({
            message: question,
            default: "defaultValue"
        });
    });

    it("responds with value from input", async () => {
        // @ts-expect-error
        inputMock.mockResolvedValue("bananas");

        await expect(input(question)).resolves.toEqual("bananas");
    });

});

describe("input with options", () => {
    const question = "select one of these please";

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("can handle default value", async () => {
        await input(
            question,
            {
                options: [
                    "option-one",
                    "option-two",
                    "option-three"
                ],
                defaultValue: "option-one"
            }
        );

        expect(selectMock).toHaveBeenCalledWith({
            message: question,
            choices: [{
                value: "option-one"
            }, {
                value: "option-two"
            }, {
                value: "option-three"
            }],
            default: "option-one"
        });
    });

    it("can handle string options", async () => {
        await input(
            question,
            {
                options: [
                    "option-one",
                    "option-two",
                    "option-three"
                ]
            }
        );

        expect(selectMock).toHaveBeenCalledWith({
            message: question,
            choices: [{
                value: "option-one"
            }, {
                value: "option-two"
            }, {
                value: "option-three"
            }]
        });
    });

    it("can handle array of choices", async () => {
        const options = [
            { value: "option-one", name: "option one" },
            { value: "option-two", name: "option two" },
            { value: "option-three", name: "option three" }
        ];

        await input(
            question,
            {
                options
            }
        );

        expect(selectMock).toHaveBeenCalledWith({
            message: question,
            choices: options
        });
    });
});

describe("editor", () => {
    const question = "edit this file please";

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("calls inquirer editor", async () => {
        await editor(
            question,
            { initialValue: "initial value of file" }
        );

        expect(editorMock).toHaveBeenCalledWith({
            message: question,
            default: "initial value of file"
        });
    });

    it("initial value not required", async () => {
        await editor(
            question
        );

        expect(editorMock).toHaveBeenCalledWith({
            message: question
        });
    });

    for (const waitForUserInputValue of [true, false]) {
        it(`specifies waitForUserInput (${waitForUserInputValue})`, async () => {

            await editor(
                question,
                {
                    waitForUserInput: waitForUserInputValue
                }
            );

            expect(editorMock).toHaveBeenCalledWith({
                message: question,
                waitForUserInput: waitForUserInputValue
            });
        });
    }

    it("resolves to be the value from editor", async () => {
        // @ts-expect-error
        editorMock.mockResolvedValue("lorem ipsum");

        await expect(editor(question)).resolves.toEqual("lorem ipsum");
    });
});
