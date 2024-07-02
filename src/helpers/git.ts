import simpleGit from "simple-git";

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
