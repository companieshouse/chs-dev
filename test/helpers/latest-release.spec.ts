import { expect, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { getLatestReleaseSatisfying, getLatestReleaseVersion } from "../../src/helpers/latest-release";

const fetchMock = jest.fn();
// @ts-expect-error
global.fetch = fetchMock;

describe("getLatestReleaseVersion", () => {
    let latestReleaseJson;
    beforeEach(() => {
        jest.resetAllMocks();

        latestReleaseJson = JSON.parse(
            readFileSync(
                join(
                    process.cwd(),
                    "test/data/latest-release/latest-release.json"
                )
            ).toString("utf8")
        );

        // @ts-expect-error
        fetchMock.mockResolvedValue({
            status: 200,
            json: () => Promise.resolve(latestReleaseJson)
        });

        delete process.env.GITHUB_PAT;
    });

    it("calls fetch to retrieve latest release", async () => {
        process.env.GITHUB_PAT = "ghp_123456789";
        await getLatestReleaseVersion();

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases/latest",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
    });

    it("returns the latest version", async () => {
        const result = await getLatestReleaseVersion();

        expect(result).toEqual("0.1.5");
    });

    it("adds authorization header when GITHUB_PAT set", async () => {
        process.env.GITHUB_PAT = "ghp_123456789";

        await getLatestReleaseVersion();

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases/latest",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
    });
});

describe("getLatestReleaseSatisfying", () => {
    const fetchMockReturnsPages = (pages: string[][]) => {
        pages.forEach((versions: string[], index: number) => {
            let links = `<https://api.github.com/repos/companieshouse/chs-dev/releases?page=${pages.length}>; rel="last"`;

            if (index !== pages.length - 1) {
                links = `<https://api.github.com/repos/companieshouse/chs-dev/releases?page=${index + 2}>; rel="next",${links}`;
            }

            fetchMock.mockResolvedValueOnce({
                headers: {
                    get: (_: string) => links
                },
                json: () => Promise.resolve(versions.map(version => ({ name: version })))
            } as never);
        });
    };

    beforeEach(() => {
        jest.resetAllMocks();

        delete process.env.GITHUB_PAT;
    });

    it("calls fetch to retrieve page of versions", async () => {
        process.env.GITHUB_PAT = "ghp_123456789";
        fetchMockReturnsPages([
            ["2.2.0", "2.0.0", "1.9.9", "1.9.8", "1.9.0", "1.1.0", "1.0.1", "1.0.0", "0.5.0", "0.1.0"]
        ]);

        await getLatestReleaseSatisfying(">=1.0.0");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
    });

    it("calls fetch once when satisfactory version found on first page", async () => {
        fetchMockReturnsPages([
            ["2.2.0", "2.0.0", "1.9.9", "1.9.8", "1.9.0", "1.5.0", "1.1.0", "1.0.1", "1.0.0", "0.5.0", "0.1.0"]
        ]);

        await getLatestReleaseSatisfying(">=1.0.0 <1.9.0");

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("calls fetch several times until finds correct version", async () => {
        process.env.GITHUB_PAT = "ghp_123456789";
        fetchMockReturnsPages([
            ["2.2.0"], ["2.0.0"], ["1.9.9"], ["1.9.8"], ["1.9.0"], ["1.5.0", "1.1.0", "1.0.1", "1.0.0", "0.5.0", "0.1.0"]
        ]);

        await getLatestReleaseSatisfying(">=1.0.0 <1.9.0");

        expect(fetchMock).toHaveBeenCalledTimes(6);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases?page=2",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases?page=3",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases?page=4",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases?page=5",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases?page=6",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
    });

    it("returns value of satisfactory version", async () => {

        fetchMockReturnsPages([
            ["2.2.0"], ["2.0.0"], ["1.9.9"], ["1.9.8"], ["1.9.0"], ["1.5.0", "1.1.0", "1.0.1", "1.0.0", "0.5.0", "0.1.0"]
        ]);

        await expect(getLatestReleaseSatisfying(">=1.0.0 <1.9.0")).resolves.toBe("1.5.0");
    });

    it("returns undefined when no satisfactory version found", async () => {

        fetchMockReturnsPages([
            ["2.2.0"], ["2.0.0"], ["1.9.9"], ["1.9.8"], ["1.9.0"], ["1.5.0", "1.1.0", "1.0.1", "1.0.0", "0.5.0", "0.1.0"]
        ]);

        await expect(getLatestReleaseSatisfying(">=10.0.0")).resolves.toBeUndefined();
    });

    it("exhausts all pages when satisfactory not found", async () => {
        fetchMockReturnsPages([
            ["2.2.0"], ["2.0.0"], ["1.9.9"], ["1.9.8"], ["1.9.0"], ["1.5.0"], ["1.1.0"], ["1.0.1"], ["1.0.0"], ["0.5.0"], ["0.1.0"]
        ]);

        await getLatestReleaseSatisfying(">=10.0.0");

        expect(fetchMock).toHaveBeenCalledTimes(11);
    });

    it("uses PAT when in environment variables", async () => {
        process.env.GITHUB_PAT = "ghp_123456789";

        fetchMockReturnsPages([
            ["2.2.0", "2.0.0", "1.9.9", "1.9.8", "1.9.0", "1.1.0", "1.0.1", "1.0.0", "0.5.0", "0.1.0"]
        ]);

        await getLatestReleaseSatisfying(">=1.0.0");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases",
            {
                headers: {
                    Authorization: "Bearer ghp_123456789"
                }
            }
        );
    });
});
