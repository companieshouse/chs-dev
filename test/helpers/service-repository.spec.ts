import { describe, expect, it } from "@jest/globals";
import { repositoryName } from "../../src/helpers/service-repository";

describe("repositoryName", () => {
    it.each([
        ["git@github.com:companieshouse/eric.git", "eric"],
        ["https://github.com/companieshouse/eric", "eric"],
        ["https://github.com/companieshouse/eric.git/", "eric"]
    ])("derives the repository name from %s", (url, expected) => {
        expect(repositoryName({ name: "eric-web", repository: { url } })).toBe(expected);
    });

    it("falls back to the service name without a repository", () => {
        expect(repositoryName({ name: "eric-web", repository: null })).toBe("eric-web");
    });
});
