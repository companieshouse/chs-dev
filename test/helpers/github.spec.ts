import { afterAll, expect, jest } from "@jest/globals";
import * as github from "../../src/helpers/github";
import { spawn as spawnPromiseMock } from "../../src/helpers/spawn-promise";
import CONSTANTS from "../../src/model/Constants";
import { displayLink as displayLinkMock } from "../../src/helpers/link";

jest.mock("../../src/helpers/spawn-promise");
jest.mock("../../src/helpers/link");

const fetchMock = jest.fn();

// @ts-expect-error
global.fetch = fetchMock;

describe("createPullRequest", () => {

    const getPersonalAccessTokenSpy = jest.spyOn(github, "getPersonalAccessToken");
    const gitHubPersonalAccessToken = "ghp_12345abcdefg67890";

    beforeEach(() => {
        jest.resetAllMocks();

        getPersonalAccessTokenSpy.mockResolvedValue(gitHubPersonalAccessToken);

        fetchMock.mockResolvedValue({
            text: "",
            status: 201,
            json: async () => ({ number: 12345 })
        } as never);
    });

    afterAll(() => {
        getPersonalAccessTokenSpy.mockRestore();
    });

    it("calls getPersonalAccessToken", async () => {
        await github.createPullRequest("test-repo", "test-branch", "test-title");

        expect(getPersonalAccessTokenSpy).toHaveBeenCalled();
    });

    it("creates Pull Request when can resolve token", async () => {
        await github.createPullRequest("test-repo", "test-branch", "test-title");

        expect(fetchMock).toHaveBeenCalledWith(`https://api.github.com/repos/${CONSTANTS.COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME}/test-repo/pulls`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${gitHubPersonalAccessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title: "test-title",
                head: "test-branch",
                base: "main"
            })
        });
    });

    it("renders link for user to create PR when cannot resolve token", async () => {
        getPersonalAccessTokenSpy.mockResolvedValue(undefined);

        await github.createPullRequest("test-repo", "test-branch", "test-title");

        expect(fetchMock).not.toHaveBeenCalled();
        expect(displayLinkMock).toHaveBeenCalledWith(
            `https://github.com/${CONSTANTS.COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME}/test-repo/compare/main...test-branch?expand=1&title=test-title`,
            "Create Pull Request (In browser)"
        );
    });

    it("renders link when fetch fails", async () => {
        fetchMock.mockRejectedValue(new Error("Error") as never);

        await github.createPullRequest("test-repo", "test-branch", "test-title");

        expect(displayLinkMock).toHaveBeenCalledWith(
            `https://github.com/${CONSTANTS.COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME}/test-repo/compare/main...test-branch?expand=1&title=test-title`,
            "Create Pull Request (In browser)"
        );
    });

    it("renders link when fetch returns non-200 status", async () => {
        fetchMock.mockResolvedValue({
            status: 500,
            text: "Internal Server Error"
        } as never);

        await github.createPullRequest("test-repo", "test-branch", "test-title");

        expect(displayLinkMock).toHaveBeenCalledWith(
            `https://github.com/${CONSTANTS.COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME}/test-repo/compare/main...test-branch?expand=1&title=test-title`,
            "Create Pull Request (In browser)"
        );
    });

    it("can specify destination branch and organisation", async () => {
        await github.createPullRequest("test-repo", "test-branch", "test-title", undefined, "test-org");

        expect(fetchMock).toHaveBeenCalledWith(`https://api.github.com/repos/test-org/test-repo/pulls`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${gitHubPersonalAccessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title: "test-title",
                head: "test-branch",
                base: "main"
            })
        });
    });
});

describe("getPersonalAccessToken", () => {

    const originalEnv = process.env;

    afterAll(() => {
        process.env = originalEnv;
    });

    describe("when GITHUB_PAT environment variable is set", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            process.env = {
                ...originalEnv,
                GITHUB_PAT: "test-pat"
            };
        });

        it("returns value of GITHUB_PAT environment variable", async () => {
            expect(await github.getPersonalAccessToken()).toEqual("test-pat");
        });
    });

    describe("when GITHUB_PAT environment variable is not set", () => {
        beforeEach(() => {
            jest.resetAllMocks();

            delete process.env.GITHUB_PAT;
        });

        it("checks if gh is installed", async () => {
            (spawnPromiseMock as jest.Mock).mockResolvedValue(undefined as never);

            await github.getPersonalAccessToken();

            expect(spawnPromiseMock).toHaveBeenCalledWith("command", ["-v", "gh"], {
                logHandler: expect.anything()
            });
        });

        it("calls gh for token if gh is installed", async () => {
            (spawnPromiseMock as jest.Mock).mockResolvedValue(undefined as never);

            await github.getPersonalAccessToken();

            expect(spawnPromiseMock).toHaveBeenCalledWith("gh", ["auth", "token"], {
                logHandler: expect.anything()
            });
        });

        it("returns undefined if gh is not installed", async () => {
            (spawnPromiseMock as jest.Mock).mockRejectedValue(undefined as never);

            await expect(github.getPersonalAccessToken()).resolves.toBeUndefined();
        });

        it("returns the token if gh is installed", async () => {
            const tokenParts = [
                "ghp_",
                "03485abcdefg812345"
            ];

            // @ts-expect-error
            (spawnPromiseMock as jest.Mock).mockResolvedValueOnce().mockImplementation((command, args, { logHandler }) => {
                for (const tokenPartBytes of tokenParts) {
                    logHandler.handle(tokenPartBytes);
                }

                return Promise.resolve();
            });

            await expect(github.getPersonalAccessToken()).resolves.toEqual(
                tokenParts.join("")
            );
        });
    });
});
