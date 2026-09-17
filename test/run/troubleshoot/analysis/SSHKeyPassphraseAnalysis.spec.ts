import { expect, jest } from "@jest/globals";
import SSHKeyPassphraseAnalysis from "../../../../src/run/troubleshoot/analysis/SSHKeyPassphraseAnalysis";
import { getItemFromKeyChain } from "../../../../src/helpers/keychain";

jest.mock("../../../../src/helpers/keychain", () => ({
    getItemFromKeyChain: jest.fn()
}));

const getItemFromKeyChainMock = getItemFromKeyChain as jest.MockedFunction<typeof getItemFromKeyChain>;

describe("SSHKeyPassphraseAnalysis", () => {
    const originalPlatform = process.platform;

    const setPlatform = (platform: string) => {
        Object.defineProperty(process, "platform", {
            value: platform
        });
    };

    afterEach(() => {
        setPlatform(originalPlatform);
        getItemFromKeyChainMock.mockClear();
    });

    it("reports an issue when the keychain value is missing on macOS", async () => {
        setPlatform("darwin");
        getItemFromKeyChainMock.mockResolvedValue(undefined);

        const outcome = await new SSHKeyPassphraseAnalysis().analyse({} as never);

        expect(outcome.isSuccess()).toBe(false);
        expect(outcome.issues[0].title).toBe("SSH key passphrase not set");
    });

    it("succeeds when the keychain value is present on macOS", async () => {
        setPlatform("darwin");
        getItemFromKeyChainMock.mockResolvedValue("secret-value");

        const outcome = await new SSHKeyPassphraseAnalysis().analyse({} as never);

        expect(outcome.isSuccess()).toBe(true);
    });

    it("skips the keychain check and always succeeds on non-macOS platforms", async () => {
        setPlatform("linux");
        getItemFromKeyChainMock.mockResolvedValue(undefined);

        const outcome = await new SSHKeyPassphraseAnalysis().analyse({} as never);

        expect(outcome.isSuccess()).toBe(true);
        expect(getItemFromKeyChainMock).not.toHaveBeenCalled();
    });
});
