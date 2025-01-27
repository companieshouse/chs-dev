import { expect, jest } from "@jest/globals";
import NewServiceSpec from "../../../src/model/NewServiceSpec";
import buildServiceSpecFromUserInput from "../../../src/run/service-factory/build-service-spec";
import { Prompt } from "../../../src/run/service-factory/prompts";

const promptMock1 = {
    make: jest.fn(),
    selector: ".name"
};

const promptMock2 = {
    make: jest.fn(),
    selector: ".type.language"
};

const promptMock3 = {
    make: jest.fn(),
    selector: ".configuration.java.spring_initializr_url",
    predicate: jest.fn()
};

describe("buildServiceSpecFromUserInput", () => {
    const prompts = [promptMock1, promptMock2, promptMock3] as Prompt[];

    const serviceSpecBuilder = buildServiceSpecFromUserInput(prompts);

    const javaNewServiceSpecComplete = {
        name: "my-awesome-new-app",
        type: {
            language: "NODE"
        },
        configuration: {
            java: {
                spring_initializr_url: "https://start.spring.io#"
            }
        }
    };

    const javaNewServiceSpec = {
        name: "my-awesome-new-app",
        type: {
            language: "JAVA"
        }
    };

    const serviceSpecOnlyName = {
        name: "my-awesome-new-app"
    };

    const nodeServiceSpec = {
        name: "my-awesome-new-app",
        type: {
            language: "NODE"
        }
    };

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it("calls first prompt with empty NewServiceSpec when not supplied", async () => {
        await serviceSpecBuilder();

        expect(promptMock1.make).toHaveBeenCalledWith({});
    });

    it("calls first prompt with supplied NewServiceSpec", async () => {
        await serviceSpecBuilder(javaNewServiceSpecComplete as Partial<NewServiceSpec>);

        expect(promptMock1.make).toHaveBeenCalledWith(javaNewServiceSpecComplete);
    });

    it("calls second prompt with the result from the first", async () => {
        promptMock1.make.mockResolvedValue(serviceSpecOnlyName as never);

        await serviceSpecBuilder();

        expect(promptMock2.make).toBeCalledWith(serviceSpecOnlyName);
    });

    it("does not call third prompt when predicate not met", async () => {
        promptMock1.make.mockResolvedValue(serviceSpecOnlyName as never);

        promptMock2.make.mockResolvedValue(nodeServiceSpec as never);

        promptMock3.predicate.mockReturnValue(false);

        await serviceSpecBuilder();

        expect(promptMock3.make).not.toHaveBeenCalled();
    });

    it("calls third prompt when predicate met", async () => {
        promptMock1.make.mockResolvedValue(serviceSpecOnlyName as never);

        promptMock2.make.mockResolvedValue(javaNewServiceSpec as never);

        promptMock3.predicate.mockReturnValue(true);

        await serviceSpecBuilder();

        expect(promptMock3.make).toHaveBeenCalledWith(javaNewServiceSpec);
    });

    it("returns the result from the 2nd prompt when predicate not met", async () => {
        promptMock1.make.mockResolvedValue(serviceSpecOnlyName as never);

        promptMock2.make.mockResolvedValue(javaNewServiceSpec as never);

        promptMock3.predicate.mockReturnValue(false);

        await expect(serviceSpecBuilder()).resolves.toBe(javaNewServiceSpec);
    });

    it("returns the result from the 3rd prompt when predicate met", async () => {
        promptMock1.make.mockResolvedValue(serviceSpecOnlyName as never);

        promptMock2.make.mockResolvedValue(javaNewServiceSpec as never);

        promptMock3.make.mockResolvedValue(javaNewServiceSpecComplete as never);

        promptMock3.predicate.mockReturnValue(true);

        await expect(serviceSpecBuilder()).resolves.toBe(javaNewServiceSpecComplete);
    });
});
