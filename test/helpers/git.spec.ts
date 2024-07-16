import { expect, jest } from "@jest/globals";
import { cloneRepo, updateRepo } from "../../src/helpers/git";
import simpleGitMock from "simple-git";

const gitCloneMock = jest.fn();
const gitPullMock = jest.fn();

jest.mock("simple-git");

describe("cloneRepo", () => {

    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        simpleGitMock.mockReturnValue({
            clone: gitCloneMock,
            pull: gitPullMock
        });
    });

    it("clones with branch to location", async () => {
        await cloneRepo({
            repositoryUrl: "git@github.com:companieshouse/repo1.git",
            destinationPath: "./local/svc1"
        });

        expect(gitCloneMock).toHaveBeenCalledWith(
            "git@github.com:companieshouse/repo1.git",
            "./local/svc1",
            []
        );
    });

    it("clones with branch to location with branch", async () => {
        await cloneRepo({
            repositoryUrl: "git@github.com:companieshouse/repo1.git",
            destinationPath: "./local/svc1",
            branch: "not-main"
        });

        expect(gitCloneMock).toHaveBeenCalledWith(
            "git@github.com:companieshouse/repo1.git",
            "./local/svc1",
            ["--branch", "not-main"]
        );
    });
});

describe("updateRepo", () => {
    beforeEach(() => {
        jest.resetAllMocks();

        // @ts-expect-error
        simpleGitMock.mockReturnValue({
            clone: gitCloneMock,
            pull: gitPullMock
        });
    });

    it("pulls repo", async () => {
        await updateRepo("./local/svc1");

        expect(simpleGitMock).toHaveBeenCalledWith("./local/svc1");
        expect(gitPullMock).toHaveBeenCalled();
    });
});
