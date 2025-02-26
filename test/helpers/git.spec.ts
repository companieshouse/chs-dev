import { expect, jest } from "@jest/globals";
import { cloneRepo, updateRepo, checkoutNewBranch, addToStage, commit, push, checkoutExistingBranch, getCommitCountAheadOfRemote } from "../../src/helpers/git";
import { simpleGit } from "simple-git";

const gitCloneMock = jest.fn();
const gitPullMock = jest.fn();
const gitCheckoutLocalMock = jest.fn();
const gitCheckoutMock = jest.fn();
const gitAddMock = jest.fn();
const gitCommitMock = jest.fn();
const gitPushMock = jest.fn();
const gitRevParseMock = jest.fn();
const gitRaw = jest.fn();

const simpleGitMock = {
    clone: gitCloneMock,
    pull: gitPullMock,
    checkout: gitCheckoutMock,
    checkoutLocalBranch: gitCheckoutLocalMock,
    add: gitAddMock,
    commit: gitCommitMock,
    push: gitPushMock,
    revparse: gitRevParseMock,
    raw: gitRaw
};

jest.mock("simple-git");

describe("cloneRepo", () => {

    beforeEach(() => {
        jest.resetAllMocks();

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
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

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
    });

    it("pulls repo", async () => {
        await updateRepo("./local/svc1");

        expect(simpleGit).toHaveBeenCalledWith("./local/svc1");
        expect(gitPullMock).toHaveBeenCalled();
    });
});

describe("checkoutNewBranch", () => {
    beforeEach(() => {
        jest.resetAllMocks();

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
    });

    it("checks out local branch", async () => {
        await checkoutNewBranch("/tmp/my-repo", "feature/branch");

        expect(gitCheckoutLocalMock).toHaveBeenCalledWith(
            "feature/branch"
        );
    });
});

describe("checkoutExistingBranch", () => {

    beforeEach(() => {
        jest.resetAllMocks();

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
    });

    it("checks out branch as expected", async () => {
        await checkoutExistingBranch(
            "/tmp/my-repo",
            "my-existing-branch"
        );

        expect(gitCheckoutMock).toHaveBeenCalledWith("my-existing-branch");
    });
});

describe("addToStage", () => {
    beforeEach(() => {
        jest.resetAllMocks();

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
    });

    it("adds the files to stage", async () => {
        await addToStage("/tmp/repo-12354as", "file-one", "file-two", "file-three");

        expect(gitAddMock).toHaveBeenCalledWith(["file-one", "file-two", "file-three"]);
    });
});

describe("commit", () => {
    beforeEach(() => {
        jest.resetAllMocks();

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
    });

    it("commits changes", async () => {
        await commit("/tmp/repo-332ed", "Added a file or two", "* Added file here and there");

        expect(gitCommitMock).toHaveBeenCalledWith(["Added a file or two", "* Added file here and there"]);
    });
});

describe("push", () => {
    beforeEach(() => {
        jest.resetAllMocks();

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
    });

    it("pushes to remote branch name when supplied", async () => {
        await push(
            "/tmp/12repo",
            "feature/remote-branch"
        );

        expect(gitPushMock).toBeCalledWith("origin", "feature/remote-branch");
    });

    it("pushes to remote branch with same name as current branch when not set", async () => {
        gitRevParseMock.mockResolvedValue("feature/local-branch-12345" as never);

        await push(
            "/tmp/12repo"
        );

        expect(gitPushMock).toBeCalledWith("origin", "feature/local-branch-12345");
    });
});

describe("getCommitCountAheadOfRemote", () => {
    beforeEach(() => {
        jest.resetAllMocks();

        (simpleGit as jest.MockedFunction<typeof simpleGit>).mockReturnValue(
            simpleGitMock as never
        );
    });

    it("get the local commits count ahead of remote", async () => {

        (simpleGitMock.raw as jest.Mock).mockReturnValue(0);
        await getCommitCountAheadOfRemote("/tmp/12repo");

        expect(gitRaw).toBeCalledWith(["rev-list", "HEAD..@{upstream}", "--count"]);
        expect(gitRaw).toHaveReturnedWith(0);
    });
});
