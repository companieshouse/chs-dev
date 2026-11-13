import { describe, expect, it } from "@jest/globals";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { currentBranch, repositoryName } from "../../src/helpers/service-repository";

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

describe("currentBranch", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "chs-dev-branch-"));
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("returns missing when the folder does not exist", () => {
        expect(currentBranch(join(dir, "absent"))).toBe("missing");
    });

    it("returns unknown when the folder is not a git repository", () => {
        mkdirSync(join(dir, "plain"));
        expect(currentBranch(join(dir, "plain"))).toBe("unknown");
    });

    it("returns the checked out branch", () => {
        execSync("git init -q -b feature-x && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init", { cwd: dir });
        expect(currentBranch(dir)).toBe("feature-x");
    });
});
