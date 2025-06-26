import { Command, Config, Flags } from "@oclif/core";
import { SynchronizeChsDevVersion } from "../run/sync-versions.js";
import { getLatestReleaseVersion } from "../helpers/latest-release.js";
import { satisfies, major, minor, patch, gt, eq } from "semver";
import ChsDevConfig from "../model/Config.js";
import { load } from "../helpers/config-loader.js";
import { documentationLink } from "../helpers/link.js";

const DOCUMENTATION_LINK = "troubleshooting-remedies/correctly-resolve-breaking-changes-from-version-migrations.md";
export class Sync extends Command {
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
        const { flags } = await this.parse(Sync);

        let comparisonVersion = flags.version || this.projectConfig.versionSpecification || "latest";

        let synchroniseVersions: boolean;

        if (comparisonVersion === "latest") {
            comparisonVersion = await getLatestReleaseVersion();
            synchroniseVersions = comparisonVersion !== this.config.version;
        } else {
            synchroniseVersions = !satisfies(this.config.version, comparisonVersion);
        }

        if (synchroniseVersions) {
            const upgradeType = this.getVersionChangeType(this.config.version, comparisonVersion);

            if (upgradeType.includes("major")) {
                const type = upgradeType.split("-")[1];
                this.log(`Major ${type} detected. Potential breaking changes — refer to the guide: ${documentationLink(DOCUMENTATION_LINK)}.`);
            }
            const synchronization = new SynchronizeChsDevVersion();

            const installedVersion = await synchronization.run(flags.force, comparisonVersion);

            this.log(`Synchronisation complete. Version ${installedVersion} installed.`);
        } else {
            this.log(`Synchronisation complete. Version: ${comparisonVersion} already installed`);
        }
    }

    private getVersionChangeType (current: string, next: string):
    "major-upgrade" | "minor-upgrade" | "patch-upgrade" |
    "major-downgrade" | "minor-downgrade" | "patch-downgrade" |
    "same" {

        if (eq(next, current)) return "same";

        const direction = gt(next, current) ? "upgrade" : "downgrade";

        if (major(next) !== major(current)) return `major-${direction}` as const;
        if (minor(next) !== minor(current)) return `minor-${direction}` as const;
        if (patch(next) !== patch(current)) return `patch-${direction}` as const;

        return "same";
    }

}

export default Sync;
