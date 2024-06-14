
const latestReleaseUrl = "https://api.github.com/repos/companieshouse/chs-dev/releases/latest";

export const getLatestReleaseVersion: () => Promise<string> = async () => {

    const response = await fetch(latestReleaseUrl)

    return (await response.json()).name;
}
