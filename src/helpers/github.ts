import { execSync } from "child_process";
import CONSTANTS from "../model/Constants.js";
import { displayLink } from "./link.js";
import { spawn } from "./spawn-promise.js";

/**
 * @returns the personal access token for the GitHub API or undefined if
 * could not be found.
 */
export const getPersonalAccessToken = async () => {
    return process.env.GITHUB_PAT || await attemptToGetFromGhCli();
};

/**
 * Creates a Pull Request for the given repository, branch and title.
 * @param repository Name of the repository
 * @param branch Name of the branch
 * @param title Title of the Pull Request
 * @param destinationBranch Name of the destination branch
 * @param organisation name of the GitHub organisation
 * @returns Promise<void> indicating the completion of the operation
 */
export const createPullRequest = async (
    repository: string,
    branch: string,
    title: string,
    destinationBranch: string | undefined = undefined,
    organisation: string | undefined = undefined
) => {
    const gitHibOrganisationName = organisation || CONSTANTS.COMPANIES_HOUSE_GITHUB_ORGANISATION_NAME;
    const githubApiToken = await getPersonalAccessToken();

    if (typeof githubApiToken !== "undefined") {
        try {
            const result = await fetch(`https://api.github.com/repos/${gitHibOrganisationName}/${repository}/pulls`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${githubApiToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    title,
                    head: branch,
                    base: destinationBranch || "main"
                })
            });

            if (result.status >= 200 && result.status < 300) {
                const apiResponse = await result.json();

                console.log(`Pull request created for ${repository} with title: ${title} id: ${apiResponse.number}`);

                return;
            }
        } catch (error) {
            console.error("Failed to create pull request, you'll have to create it using your web browser", error);
        }
    }

    openPullRequestInBrowser(gitHibOrganisationName, repository, destinationBranch, branch, title);
};

/**
 * Fetches the GitHub repository description using the gh CLI.
 * @param repository
 * @param muteError
 * @returns returned as a string, the description of the repository
 */
export const getRepositoryDescription = (repositoryName: string, muteError = false): string => {
    try {
        const stdout = execSync(`
            gh repo view --json 'description' companieshouse/${repositoryName} 2>/dev/null`).toString("utf8");

        const parsed = JSON.parse(stdout);
        return parsed.description ?? "No description available.";
    } catch (error) {
        if (!muteError) {
            console.error(`Failed to fetch description for ${repositoryName}:`, error);
            return "Error fetching description.";
        }
        return "No description available.";
    }
};

/**
  * Fetches the repository code_owner using the gh CLI.
 * @param repository
 * @param muteError
 * @returns team-code-owner value
 */
export const getRespositoryOwner = (repositoryName: string, muteError = false): string => {
    try {
        const stdout = execSync(`gh api /repos/companieshouse/${repositoryName} --jq '.custom_properties["team-code-owner"]' 2>/dev/null`).toString("utf8");

        return stdout || "Unknown repository owner.";
    } catch (error) {
        if (!muteError) {
            console.error(`Failed to fetch team code owner for ${repositoryName}:`, error);
            return "Error fetching team code owner.";
        }
        return "Unknown repository owner.";
    }
};

const attemptToGetFromGhCli = async () => {
    try {
        await spawn("command", ["-v", "gh"], {
            logHandler: {
                handle: () => { }
            }
        });

        const tokenReader = new TokenReaderLogHandler();
        tokenReader.reset();

        await spawn("gh", ["auth", "token"], {
            logHandler: tokenReader
        });

        return tokenReader.tokenValue;
    } catch (error) {
        return undefined;
    }
};

class TokenReaderLogHandler {
    private token: string;

    constructor () {
        this.token = "";
    }

    handle (logEntry: string) {
        this.token += logEntry;
    }

    reset () {
        this.token = "";
    }

    get tokenValue () {
        return this.token;
    }
}

const openPullRequestInBrowser = (
    gitHibOrganisationName: string,
    repository: string,
    destinationBranch: string | undefined,
    branch: string,
    title: string
) => {
    displayLink(
        `https://github.com/${gitHibOrganisationName}/${repository}/compare/${destinationBranch || "main"}...${branch}?expand=1&title=${title}`,
        "Create Pull Request (In browser)"
    );
};
