import { expect, jest } from "@jest/globals";
import FinalConfirmationPrompt from "../../../../src/run/service-factory/prompts/FinalConfirmationPrompt";
import NewServiceSpec from "../../../../src/model/NewServiceSpec";
import { confirm as confirmMock, editor as editorMock } from "../../../../src/helpers/user-input";
import yaml from "yaml";

jest.mock("../../../../src/helpers/user-input");

const fullServiceSpec: NewServiceSpec = {
    name: "test-service",
    description: "A test service",
    type: {
        name: "MICROSERVICE",
        language: "JAVA"
    },
    configuration: {
        "docker-chs-development": {
            module: "test"
        }
    },
    submission_details: {
        by: "ch-test-user",
        github_username: "ch-test-user"
    },
    ownership: {
        team: "Coblyn",
        service: "Common Component"
    },
    sensitive: false
};

const yamlRepresentation = `
name: test-service
description: A test service
type:
  name: MICROSERVICE
  language: JAVA
`;

const amendedServiceSpec = {
    ...fullServiceSpec,
    name: "amended-service-name"
};

describe.only("FinalConfirmationPrompt", () => {

    const yamlStringifySpy = jest.spyOn(yaml, "stringify");
    const yamlParseSpy = jest.spyOn(yaml, "parse");
    const consoleLogSpy = jest.spyOn(console, "log");

    let finalConfirmationPrompt: FinalConfirmationPrompt;

    beforeEach(() => {
        jest.resetAllMocks();
        finalConfirmationPrompt = new FinalConfirmationPrompt();

        yamlStringifySpy.mockReturnValue(yamlRepresentation);
        yamlParseSpy.mockReturnValue(amendedServiceSpec);
        (confirmMock as jest.Mock).mockReturnValue(true);
    });

    it("asks user if they are happy with the service spec", async () => {
        await finalConfirmationPrompt.make(fullServiceSpec);

        expect(confirmMock).toHaveBeenCalledWith("Are you happy with the above service specification?");
    });

    it("loops if user is not happy with the service spec", async () => {
        (confirmMock as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true);

        await finalConfirmationPrompt.make(fullServiceSpec);

        expect(confirmMock).toHaveBeenCalledTimes(2);
    });

    it("logs the service spec as YAML", async () => {
        await finalConfirmationPrompt.make(fullServiceSpec);

        expect(yamlStringifySpy).toHaveBeenCalledWith(fullServiceSpec);
        expect(consoleLogSpy).toHaveBeenCalledWith(yamlRepresentation);
    });

    it("asks user to edit the yaml if they are not happy", async () => {
        (confirmMock as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true);
        (editorMock as jest.Mock).mockReturnValue(yamlRepresentation as never);

        await finalConfirmationPrompt.make(fullServiceSpec);

        expect(editorMock).toHaveBeenCalledWith("Amend the service specification as desired", {
            initialValue: yamlRepresentation,
            waitForUserInput: false
        });
    });

    it("returns the final service spec when user is happy first time", async () => {
        const finalServiceSpec = await finalConfirmationPrompt.make(fullServiceSpec);

        expect(finalServiceSpec).toEqual(fullServiceSpec);
    });

    it("returns modified service spec when user is happy after editing", async () => {
        (confirmMock as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true);
        (editorMock as jest.Mock).mockReturnValue(yamlRepresentation as never);

        const finalServiceSpec = await finalConfirmationPrompt.make(fullServiceSpec);

        expect(finalServiceSpec).toEqual(amendedServiceSpec);
    });

});
