import { expect, jest } from "@jest/globals";

const spawnMock = jest.fn<(
    command: string,
    args: string[],
    options: { logHandler: { handle: (entry: string) => void } }
) => Promise<void>>();

jest.mock("../../src/helpers/spawn-promise", () => ({
    spawn: spawnMock
}));

describe("getItemFromKeyChain", () => {
    let getItemFromKeyChain: (key: string) => Promise<string | undefined>;

    beforeEach(async () => {
        jest.clearAllMocks();
        ({ getItemFromKeyChain } = await import("../../src/helpers/keychain"));
    });

    it("reads the permitted SSH passphrase item", async () => {
        spawnMock.mockImplementation(async (_command, _args, options) => {
            options.logHandler.handle("secret-value\n");
        });

        await expect(getItemFromKeyChain("ch-chs-dev:SSH_KEY_PASSPHRASE"))
            .resolves.toBe("secret-value");
        expect(spawnMock).toHaveBeenCalledWith(
            "security",
            ["find-generic-password", "-s", "ch-chs-dev:SSH_KEY_PASSPHRASE", "-w"],
            expect.any(Object)
        );
    });

    it("returns undefined when the keychain lookup fails", async () => {
        spawnMock.mockRejectedValue(new Error("not found"));

        await expect(getItemFromKeyChain("ch-chs-dev:SSH_KEY_PASSPHRASE"))
            .resolves.toBeUndefined();
    });

    it("rejects requests for non-permitted keychain items", async () => {
        await expect(getItemFromKeyChain("another-secret"))
            .rejects.toThrow("is not permitted");
        expect(spawnMock).not.toHaveBeenCalled();
    });
});
