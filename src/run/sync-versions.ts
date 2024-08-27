import { rmSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { getLatestReleaseSatisfying } from "../helpers/latest-release.js";
import { spawn } from "../helpers/spawn-promise.js";
import LogEverythingLogHandler from "./logs/LogEverythingLogHandler.js";

const versionSpecificationPattern = /[<>=!]{1,2}\d+\.\d+\.\d+|.+ .*/;

export class SynchronizeChsDevVersion {

    async run (force: boolean, versionSpecification: string): Promise<string> {
        const tempDir = mkdtempSync("synchronize-chs-dev");

        let version: string;

        // If been supplied a version range/specification find a version which satisfies the specification
        if (versionSpecificationPattern.test(versionSpecification)) {
            const latestRelease = await getLatestReleaseSatisfying(versionSpecification);

            if (latestRelease) {
                version = latestRelease;
            } else {
                throw new Error(`Could not find a version of chs-dev that satisfies: ${versionSpecification}`);
            }
        } else {
            version = versionSpecification;
        }

        try {
            await this.runInstall(tempDir, force, version);
        } finally {
            rmSync(
                tempDir, {
                    force: true,
                    recursive: true
                }
            );
        }

        return version;
    }

    private async runInstall (tempDir: string, force: boolean, version: string): Promise<void> {
        const fetchInstallScriptResponse = await fetch(
            "https://raw.githubusercontent.com/companieshouse/chs-dev/main/install.sh"
        );

        const installScript = join(tempDir, "install.sh");

        writeFileSync(
            installScript,
            await fetchInstallScriptResponse.text()
        );

        return spawn(
            "bash",
            [
                installScript,
                ...(this.installationArgs(force, version))
            ], {
                logHandler: new LogEverythingLogHandler({ log: console.log })
            }
        );
    }

    private installationArgs (force: boolean, version: string): string[] {
        const args: string[] = [];

        if (force) {
            args.push("-f");
        }

        if (this.isVersionSet(version)) {
            args.push("-v");
            args.push(version);
        }

        return args;
    }

    private isVersionSet (version: string): boolean {
        return version !== "latest";
    }
}
