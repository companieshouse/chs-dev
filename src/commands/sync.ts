import { Command, Flags } from "@oclif/core";
import { SynchronizeChsDevVersion } from "../run/sync-versions.js";

export default class Sync extends Command {
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

        const synchronization = new SynchronizeChsDevVersion();

        await synchronization.run(flags.force, flags.version);
    }

}
