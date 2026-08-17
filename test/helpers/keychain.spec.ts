import { expect, jest } from "@jest/globals";
import { getItemFromKeyChain } from "../../src/helpers/keychain";
import { spawn } from "../../src/helpers/spawn-promise";
import CONSTANTS from "../../src/model/Constants";

jest.mock("../../src/helpers/spawn-promise");

describe("keychain", () => {
    const PERMITTED_KEY = CONSTANTS.SSH_PASSWORD_KEYCHAIN_ITEM_NAME;

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

            const result = await getItemFromKeyChain(PERMITTED_KEY);

            expect(result).toBe(expectedValue);
            expect(spawn).toHaveBeenCalledWith(
                "security",
                ["find-generic-password", "-s", PERMITTED_KEY, "-w"],
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

            const result = await getItemFromKeyChain(PERMITTED_KEY);

            expect(result).toBe("part-one-part-two");
        });

        it("should return undefined when no logs are captured", async () => {
            (spawn as jest.Mock).mockImplementation(async () => undefined);

            const result = await getItemFromKeyChain(PERMITTED_KEY);

            expect(result).toBeUndefined();
        });

        it("should return undefined when spawn rejects", async () => {
            (spawn as jest.Mock).mockImplementation(async () => {
                throw new Error("command failed");
            });

            const result = await getItemFromKeyChain(PERMITTED_KEY);

            expect(result).toBeUndefined();
        });

        it("should throw an error when the requested key is not permitted", async () => {
            await expect(getItemFromKeyChain("non-permitted-key")).rejects.toThrow(
                "Requested keychain item \"non-permitted-key\" is not permitted to be read."
            );

            expect(spawn).not.toHaveBeenCalled();
        });

    });

});
