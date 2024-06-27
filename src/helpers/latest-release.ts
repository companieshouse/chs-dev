import { satisfies } from "semver";

const githubReleasesApiUrl = "https://api.github.com/repos/companieshouse/chs-dev/releases";
const latestReleaseUrl = `${githubReleasesApiUrl}/latest`;

/**
 * fetches the latest version name from GitHub
 * @returns latest version name
 */
export const getLatestReleaseVersion: () => Promise<string> = async () => {

    const response = await fetch(latestReleaseUrl, githubRequestParameters());

    return (await response.json()).name;
};

/**
 * Finds out the latest version which matches the specification specified.
 * @param versionSpec specification of the version required
 * @returns latest version or undefined if there were no matches
 */
export const getLatestReleaseSatisfying = async (versionSpec: string): Promise<string | undefined> => {
    const githubVersionsIterable = githubReleaseGenerator();

    let githubRelease: IteratorResult<string, undefined>;

    do {
        githubRelease = await githubVersionsIterable.next();

        if (githubRelease.value && satisfies(githubRelease.value, versionSpec)) {
            return githubRelease.value;
        }
    } while (!githubRelease.done);

    return undefined;
};

/**
 * Generator function which will generate/yield version names handling Github API
 * pagination
 */
async function * githubReleaseGenerator (): AsyncGenerator<string, undefined, undefined> {
    // Start with the all releases link
    let releasesLink: string | undefined = githubReleasesApiUrl;

    while (releasesLink) {
        // Fetch page of releases
        const releasesResponse = await fetch(releasesLink, githubRequestParameters());

        // Load body and link header
        const body = await releasesResponse.json();

        const linkHeader = releasesResponse.headers.get("link");

        // Yield release names held in page of results
        for (const release of body) {
            yield release.name;
        }

        // When there is no link header then there was only one page of results
        if (linkHeader === null) {
            releasesLink = undefined;
        } else {
            // Look for next link in the Link header
            const nextLink = /<([^>]+)>;\s+rel="next"/;

            const nextLinkMatches = linkHeader.match(nextLink);

            // If there is next link use this as the next url otherwise break
            if (nextLinkMatches) {
                releasesLink = nextLinkMatches[1];
            } else {
                releasesLink = undefined;
            }
        }
    }
}

const githubRequestParameters = () => {
    const parameters: {
        headers?: Record<string, string>
    } = {};

    if ("GITHUB_PAT" in process.env && typeof process.env.GITHUB_PAT !== "undefined") {
        parameters.headers = {
            Authorization: `Bearer ${process.env.GITHUB_PAT}`
        };
    }

    return parameters;
};
