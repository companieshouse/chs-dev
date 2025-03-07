import { Command, Config, Flags } from "@oclif/core";
import { SynchronizeChsDevVersion } from "../run/sync-versions.js";
import { getLatestReleaseVersion } from "../helpers/latest-release.js";
import { satisfies } from "semver";
import ChsDevConfig from "../model/Config.js";
import { load } from "../helpers/config-loader.js";
import { VersionCheck } from "../run/version-check.js";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

export default class VersionHistory extends Command {
    static description = `Synchronises the local version to the version specifed

Calls the GitHub API to resolve the version depending on whether the version specified
will depend on the number of calls to the GitHub API, the CLI may require the environment
variable 'GITHUB_PAT' set with a PAT capable of calling GitHub. GitHub rate limiting
will prevent >60 unauthenticated requests an hour.
`;

    static flags = {
        version: Flags.string({
            char: "v",
            aliases: ["version"],
            summary: "Specifies the version/version range to sync to. " +
                "When a range is specified it will select the most recent " +
                "that satisfies the range"
        }),
        force: Flags.boolean({
            char: "f",
            aliases: ["force"],
            summary: "Forces all changes without prompting the user."
        })
    };

    private readonly projectConfig: ChsDevConfig;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        this.projectConfig = load();
    }

    async run (): Promise<any> {
        const { flags } = await this.parse(VersionHistory);

        const filePath = join(this.config.root, "changelog.log");
        if (!existsSync(filePath)) {
            this.log(`Version history file not found. Run chs-dev sync first.`);
        }
        const versionHistorycontent = readFileSync(filePath, "utf8").trim();
        this.log(versionHistorycontent);

    }

}
