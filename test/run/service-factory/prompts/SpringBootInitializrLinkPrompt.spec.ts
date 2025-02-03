import { expect, jest } from "@jest/globals";
import SpringBootInitializrLinkPrompt from "../../../../src/run/service-factory/prompts/SpringBootInitializrLinkPrompt";
import NewServiceSpec from "../../../../src/model/NewServiceSpec";
import { displayLink as displayLinkMock } from "../../../../src/helpers/link";
import { constructInitializrLink } from "../../../../src/helpers/spring-boot-initializr-link";
import { input as inputMock, confirm as confirmMock } from "../../../../src/helpers/user-input";

jest.mock("../../../../src/helpers/link");
jest.mock("../../../../src/helpers/user-input");

describe("SpringBootInitializrLinkPrompt", () => {

    let springBootInitializrLinkPrompt: SpringBootInitializrLinkPrompt;

    beforeEach(() => {
        jest.resetAllMocks();
        springBootInitializrLinkPrompt = new SpringBootInitializrLinkPrompt(".configuration.java.spring_initializr_url");
        (inputMock as jest.Mock).mockResolvedValue("link" as never);
        (confirmMock as jest.Mock).mockResolvedValue(true as never);
    });

    it("predicate returns true when java microservice is selected", () => {
        const newServiceSpec = {
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        } as Partial<NewServiceSpec>;

        expect(springBootInitializrLinkPrompt.predicate(newServiceSpec)).toBe(true);
    });

    it("predicate returns false when no type is selected", () => {
        const newServiceSpec = {} as Partial<NewServiceSpec>;

        expect(springBootInitializrLinkPrompt.predicate(newServiceSpec)).toBe(false);
    });

    it("predicate returns false when language is not java", () => {
        const newServiceSpec = {
            type: {
                name: "MICROSERVICE",
                language: "NODE"
            }
        } as Partial<NewServiceSpec>;

        expect(springBootInitializrLinkPrompt.predicate(newServiceSpec)).toBe(false);
    });

    it("make displays link for the user to click", async () => {
        const newServiceSpec = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        } as Partial<NewServiceSpec>;

        await springBootInitializrLinkPrompt.make(newServiceSpec);

        expect(displayLinkMock).toBeCalledWith(
            constructInitializrLink(newServiceSpec),
            "Open Spring Initializr"
        );
    });

    it("prompts user to enter a spring initializr link", async () => {
        const newServiceSpec = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        } as Partial<NewServiceSpec>;

        await springBootInitializrLinkPrompt.make(newServiceSpec);

        expect(inputMock).toBeCalledWith("Enter the link to the project shared from Spring Initializr");
    });

    it("asks user to confirm they want to use the default link when not supplied", async () => {
        const newServiceSpec = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        } as Partial<NewServiceSpec>;

        (inputMock as jest.Mock).mockResolvedValue(undefined as never);

        await springBootInitializrLinkPrompt.make(newServiceSpec);

        expect(confirmMock).toBeCalledWith("No link provided. Would you like to use the default link?");
    });

    it("sets the spring boot initializr link property on returned spec", async () => {
        const newServiceSpec = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        } as Partial<NewServiceSpec>;

        const expectedLink = constructInitializrLink(newServiceSpec) + "&test=1";

        (inputMock as jest.Mock).mockResolvedValue(expectedLink as never);

        await expect(springBootInitializrLinkPrompt.make(newServiceSpec)).resolves.toEqual({
            ...newServiceSpec,
            configuration: {
                java: {
                    spring_initializr_url: expectedLink
                }
            }
        });
    });

    it("sets the default value when not supplied and user confirms", async () => {
        const newServiceSpec = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        } as Partial<NewServiceSpec>;

        const expectedLink = constructInitializrLink(newServiceSpec);

        (inputMock as jest.Mock).mockResolvedValue(undefined as never);
        (confirmMock as jest.Mock).mockResolvedValue(true as never);

        await expect(springBootInitializrLinkPrompt.make(newServiceSpec)).resolves.toEqual({
            ...newServiceSpec,
            configuration: {
                java: {
                    spring_initializr_url: expectedLink
                }
            }
        });
    });

    it("repeat prompt when user does not provide a link and not confirmed", async () => {
        const newServiceSpec = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        } as Partial<NewServiceSpec>;

        (inputMock as jest.Mock).mockResolvedValueOnce(undefined as never).mockResolvedValue("link" as never);
        (confirmMock as jest.Mock).mockResolvedValue(false as never);

        await springBootInitializrLinkPrompt.make(newServiceSpec);

        expect(inputMock).toBeCalledTimes(2);
    });

    it("repeats 5 times before throwing an error", async () => {
        const newServiceSpec: Partial<NewServiceSpec> = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            }
        };

        (inputMock as jest.Mock).mockResolvedValue(undefined as never);
        (confirmMock as jest.Mock).mockResolvedValue(false as never);

        await expect(springBootInitializrLinkPrompt.make(newServiceSpec)).rejects.toThrowError("Invalid response to question: failed after 5 attempts");

        expect(inputMock).toBeCalledTimes(5);
    });

    it("returns the newServiceSpec without changing it if the user does not want to change it", async () => {
        const newServiceSpec: Partial<NewServiceSpec> = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            },
            configuration: {
                java: {
                    spring_initializr_url: "link"
                }
            }
        };

        (confirmMock as jest.Mock).mockResolvedValue(false as never);

        await expect(springBootInitializrLinkPrompt.make(newServiceSpec)).resolves.toEqual(newServiceSpec);
    });

    it("prompts user to enter a spring initializr link when user wants to change it", async () => {
        const newServiceSpec: Partial<NewServiceSpec> = {
            name: "my-service",
            description: "my service description",
            type: {
                name: "MICROSERVICE",
                language: "JAVA"
            },
            configuration: {
                java: {
                    spring_initializr_url: "link"
                }
            }
        };

        (confirmMock as jest.Mock).mockResolvedValue(true as never);
        (inputMock as jest.Mock).mockResolvedValue("new-link" as never);

        await springBootInitializrLinkPrompt.make(newServiceSpec);

        expect(inputMock).toHaveBeenCalled();
    });
});
