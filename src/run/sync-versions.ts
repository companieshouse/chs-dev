import { spawn } from "child_process";
// @ts-expect-error
import { rmSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";

export class SynchronizeChsDevVersion {

    async run (force: boolean, version: string): Promise<void> {
        const tempDir = mkdtempSync("synchronize-chs-dev");

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
        return new Promise((resolve, reject) => {

            const bashProcess = spawn(
                "bash",
                [
                    installScript,
                    ...(this.installationArgs(force, version))
                ]
            );

            bashProcess.stdout.on("data", async (data) => {
                const stdoutData: string = data.toString("utf8");

                console.log(stdoutData.trim());
            });

            bashProcess.stderr.on("data", async (data) => {
                const stdoutData: string = data.toString("utf8");

                console.error(stdoutData.trim());
            });

            bashProcess.once("close", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(code);
                }
            });

            bashProcess.once("exit", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(code);
                }
            });

            bashProcess.once("error", (error) => {
                reject(error);
            });
        });
    }

    private installationArgs (force: boolean, version: string): string[] {
        let args: string[] = [];
        const versionSet = this.isVersionSet(version);

        if (force || versionSet) {
            args = [
                "--"
            ];
        }

        if (force) {
            args.push("-f");
        }

        if (versionSet) {
            args.push("-v");
            args.push(version);
        }

        return args;
    }

    private isVersionSet (version: string): boolean {
        return version !== "latest";
    }
}
