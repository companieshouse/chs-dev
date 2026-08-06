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
    // @ts-ignore
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
    // @ts-ignore
    const git = simpleGit(destinationPath);

    return git.pull();
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

export const gitSshToHttps = (sshUrl: string): string => {
    const sshPattern = /^git@([^:]+):(.+?)(\.git)?$/;
    const match = sshUrl.match(sshPattern);
    if (!match) {
        throw new Error("Invalid SSH Git URL format");
    }

    const [, host, repoPath] = match;
    return `https://${host}/${repoPath}`;
};
