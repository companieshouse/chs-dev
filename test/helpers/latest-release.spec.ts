import { expect, jest } from "@jest/globals";
import { getLatestReleaseVersion } from "../../src/helpers/latest-release";
import { readFileSync } from "fs";
import { join } from "path";

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
        )

        // @ts-expect-error
        fetchMock.mockResolvedValue({
            status: 200,
            json: () => Promise.resolve(latestReleaseJson)
        })
    })

    it("calls fetch to retrieve latest release", async () => {
        await getLatestReleaseVersion();

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.github.com/repos/companieshouse/chs-dev/releases/latest"
        )
    })

    it("returns the latest version", async() => {
        const result = await getLatestReleaseVersion();

        expect(result).toEqual("0.1.5")
    })
})
