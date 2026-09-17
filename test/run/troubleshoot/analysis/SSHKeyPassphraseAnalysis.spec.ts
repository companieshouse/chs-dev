import { expect, jest } from "@jest/globals";
import SSHKeyPassphraseAnalysis from "../../../../src/run/troubleshoot/analysis/SSHKeyPassphraseAnalysis";
import { getItemFromKeyChain } from "../../../../src/helpers/keychain";

jest.mock("../../../../src/helpers/keychain", () => ({
    getItemFromKeyChain: jest.fn()
}));

const getItemFromKeyChainMock = getItemFromKeyChain as jest.MockedFunction<typeof getItemFromKeyChain>;

describe("SSHKeyPassphraseAnalysis", () => {
    it("reports an issue when the keychain value is missing", async () => {
        getItemFromKeyChainMock.mockResolvedValue(undefined);

        const outcome = await new SSHKeyPassphraseAnalysis().analyse({} as never);

        if (process.platform === "darwin") {
            expect(outcome.isSuccess()).toBe(false);
            expect(outcome.issues[0].title).toBe("SSH key passphrase not set");
        } else {
            expect(outcome.isSuccess()).toBe(true);
        }
    });

    it("succeeds when the keychain value is present", async () => {
        getItemFromKeyChainMock.mockResolvedValue("secret-value");

        const outcome = await new SSHKeyPassphraseAnalysis().analyse({} as never);

        expect(outcome.isSuccess()).toBe(true);
    });
});
