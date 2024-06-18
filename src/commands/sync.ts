import { Command, Flags } from "@oclif/core";
import { SynchronizeChsDevVersion } from "../run/sync-versions.js";
import { getLatestReleaseVersion } from "../helpers/latest-release.js";

export class Sync extends Command {
    static description = "Synchronises the local version to the version specifed";

    static flags = {
        version: Flags.string({
            char: "v",
            aliases: ["version"],
            default: "latest",
            summary: "Specifies the version to sync to"
        }),
        force: Flags.boolean({
            char: "f",
            aliases: ["force"],
            summary: "Forces all changes without prompting the user."
        })
    };

    async run (): Promise<any> {
        const { flags } = await this.parse(Sync);

        let comparisonVersion = flags.version;

        if (comparisonVersion === "latest") {
            comparisonVersion = await getLatestReleaseVersion();
        }

        if (comparisonVersion !== this.config.version) {
            const synchronization = new SynchronizeChsDevVersion();

            await synchronization.run(flags.force, flags.version);

            this.log(`Synchronisation complete. Version ${comparisonVersion} installed.`);
        } else {
            this.log(`Synchronisation complete. Version: ${comparisonVersion} already installed`);
        }
    }

}

export default Sync;
