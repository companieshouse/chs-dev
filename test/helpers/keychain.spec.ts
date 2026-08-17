import { expect, jest } from "@jest/globals";
import { getItemFromKeyChain } from "../../src/helpers/keychain";
import { spawn } from "../../src/helpers/spawn-promise";

jest.mock("../../src/helpers/spawn-promise");

describe("keychain", () => {

    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe("getItemFromKeyChain", () => {

        it("should return the value written to the log handler by spawn", async () => {
            const expectedValue = "super-secret-value";

            (spawn as jest.Mock).mockImplementation(async (...args: any[]) => {
                const options: any = args[2];

                options.logHandler.handle(expectedValue);
            });

            const result = await getItemFromKeyChain("my-key");

            expect(result).toBe(expectedValue);
            expect(spawn).toHaveBeenCalledWith(
                "security",
                ["find-generic-password", "-s", "my-key", "-w"],
                expect.objectContaining({
                    logHandler: expect.anything(),
                    stderrLogHandler: expect.anything()
                })
            );
        });

        it("should join multiple log entries together when returning the value", async () => {
            (spawn as jest.Mock).mockImplementation(async (...args: any[]) => {
                const options: any = args[2];

                options.logHandler.handle("part-one-");
                options.logHandler.handle("part-two");
            });

            const result = await getItemFromKeyChain("my-key");

            expect(result).toBe("part-one-part-two");
        });

        it("should return undefined when no logs are captured", async () => {
            (spawn as jest.Mock).mockImplementation(async () => undefined);

            const result = await getItemFromKeyChain("my-key");

            expect(result).toBeUndefined();
        });

        it("should return undefined when spawn rejects", async () => {
            (spawn as jest.Mock).mockImplementation(async () => {
                throw new Error("command failed");
            });

            const result = await getItemFromKeyChain("non-existent-key");

            expect(result).toBeUndefined();
        });

    });

});
