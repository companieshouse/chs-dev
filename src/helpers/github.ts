import { execSync } from "child_process";
import { spawn } from "./spawn-promise.js";

/**
 * @returns the personal access token for the GitHub API or undefined if
 * could not be found.
 */
export const getPersonalAccessToken = async () => {
    return process.env.GITHUB_PAT || await attemptToGetFromGhCli();
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
