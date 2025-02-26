import { simpleGit } from "simple-git";

type CloneRepoOpts = {
    repositoryUrl: string;
    destinationPath: string;
    branch?: string | null;
}

/**
 * Clones the supplied repository to the destinationPath optionally checking
 * out a named branch
 * @param cloneRepoOptions - Options regarding the clone operation containing
 *          the repository and destination information
 * @returns Promise
 */
export const cloneRepo = ({ repositoryUrl, destinationPath, branch }: CloneRepoOpts) => {
    const git = simpleGit();

    const gitArgs = branch ? ["--branch", branch] : [];

    return git.clone(
        repositoryUrl, destinationPath, gitArgs
    );
};

/**
 * Updates the code of the repository at the path specified by doing a Git pull
 * @param destinationPath path to repository being updated
 * @returns Promise
 */
export const updateRepo = (destinationPath: string) => {
    const git = simpleGit(destinationPath);

    return git.pull();
};

/**
 * Creates a new local branch of the repository supplied with the name as
 * supplied in parameter: branchName
 * @param repoPath path to the local copy of the repository
 * @param branchName name of the branch to create
 * @returns promise indicating the outcome of the create branch action
 */
export const checkoutNewBranch = (repoPath: string, branchName: string) => {
    const git = simpleGit(repoPath);

    return git.checkoutLocalBranch(branchName);
};

/**
 * Checks out the branch that should already exist in the repository
 * @param repoPath Path to the git repository locally
 * @param branchName Name of the branch to checkout
 * @returns Promise indicating the result of checkout
 */
export const checkoutExistingBranch = (
    repoPath: string, branchName: string
) => {
    const git = simpleGit(repoPath);

    return git.checkout(branchName);
};

/**
 * Adds the supplied files which are part of the repository to the stage
 * @param repoPath path to the local repository
 * @param files to be added to the stage
 * @returns Promise indicating the result of the add action
 */
export const addToStage = (repoPath: string, ...files: string[]) => {
    const git = simpleGit(repoPath);

    return git.add(files);
};

/**
 * Commits the current stage in the local repository with the supplied commit
 * message. When array will be individual lines like git commit -m ... -m ...
 * @param repoPath path to local repo
 * @param commitMessage message to be set as the commit message
 * @returns Promise indicating the result
 */
export const commit = (repoPath: string, ...commitMessage: string[]) => {
    const git = simpleGit(repoPath);

    return git.commit(
        commitMessage
    );
};

/**
 * Pushes the current head of the local branch to the remote 'origin' the
 * destination branch is supplied otherwise will use the branch name as
 * the same as the local branch name
 * @param repoPath Path to the local git repository
 * @param remoteBranchName name of the remote branch
 * @returns Promise indicating the result.
 */
export const push = async (repoPath: string, remoteBranchName?: string) => {
    const git = simpleGit(repoPath);
    const remoteName = "origin";

    if (typeof remoteBranchName !== "undefined") {
        return git.push(
            remoteName,
            remoteBranchName
        );
    } else {
        const currentBranchName = await git.revparse(["--abbrev-ref", "HEAD"]);

        return git.push(
            remoteName,
            currentBranchName
        );
    }
};

/**
 * Get the number of commits in the remote branch that are not in the local (checkout) branch.
 *
 * This function compares the current local (checkout) branch to its associated upstream remote branch
 * and returns the number of commits that exist in the remote branch but not in the local branch.
 * This tells you how many commits are **ahead** on the remote branch.
 *
 * @param {string} repoPath - The path to the local Git repository.
 * @returns {Promise<number>} The number of commits in the remote branch but not in the local branch.
 */
export const getCommitCountAheadOfRemote = async (repoPath: string): Promise<number> => {
    const git = simpleGit(repoPath);

    return Number(await git.raw(["rev-list", "HEAD..@{upstream}", "--count"]));
};
