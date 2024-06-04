import { Command } from "@oclif/core";

export default class Sync extends Command {
    private static readonly RELEASES_URL = "https://github.com/companieshouse/acsp-api/releases/latest";

    async run (): Promise<any> {
        const releasesResponse = await fetch(Sync.RELEASES_URL, {
            // @ts-expect-error
            follow: 20
        });

        this.log(releasesResponse.status.toString());

        if (releasesResponse.status <= 200 && releasesResponse.status < 300) {
            const releases = await releasesResponse.text();

            this.log(releases);
        }
    }
}
