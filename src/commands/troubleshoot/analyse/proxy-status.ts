import { Command, Config } from "@oclif/core";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import TroubleShootOutputLogger from "../utils/logger.js";

type DockerSettingsInterface = {
    OverrideProxyHTTP: string;
    OverrideProxyHTTPS: string;
    SettingsVersion:number
    ProxyHttpMode: string
    ProxyHTTPMode: string
}

export default class TroubleshootProxyStatus extends Command {

    static description = "Checks user's proxy configuration " +
        "and docker proxy configuration  ";

    private readonly outputLogger: TroubleShootOutputLogger;

    constructor (argv: string[], config: Config) {
        super(argv, config);

        const logger: (msg: string) => void = (msg: string) => this.log(msg);
        this.outputLogger = new TroubleShootOutputLogger(logger);
    }

    async run (): Promise<any> {
        const result = await this.checkCHProxyConfig();
        if (result === "success") {
            const dockerProxyResult = await this.checkDockerSettingsConfig();
            if (dockerProxyResult === "success") {
                this.outputLogger.logMessage("No issues found on proxy config", "Success");
                this.exit(0);
            }
        } else {
            this.exit(1);
        }
    }

    private checkCHProxyConfig (): Promise<string> {
        const chProxy = process.env.CH_PROXY_HOST;
        if (chProxy) {
            try {
                const output = execSync(`ping -c3 ${chProxy}`, { encoding: "utf-8" });
                return Promise.resolve("success");
            } catch (error) {
                this.outputLogger.logMessage("HTTPS_PROXY ping unsuccessful", "Error");
                return Promise.reject(new Error("error"));
            }
        } else {
            this.outputLogger.logMessage("HTTPS_PROXY env missing", "Error");
            return Promise.reject(new Error("error"));
        }
    }

    private checkDockerSettingsConfig (): Promise<string> {
        const httpProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        const settingsFilePath = this.getDockerSettingsFilePath;

        try {
            if (!fs.existsSync(settingsFilePath)) {
                this.outputLogger.logMessage("Docker settings file not found", "Error");
                return Promise.reject(new Error("error"));

            }

            const fileContents = fs.readFileSync(settingsFilePath, "utf-8");
            const settings:DockerSettingsInterface = JSON.parse(fileContents);

            if (
                !(settings.OverrideProxyHTTP === httpProxy &&
                settings.OverrideProxyHTTPS === httpProxy &&
                (settings.ProxyHTTPMode === "manual" || settings.ProxyHttpMode === "manual"))
            ) {
                this.outputLogger.logMessage("Docker Proxy Settings invalid", "Error");
                return Promise.reject(new Error("error"));
            }
            return Promise.resolve("success");

        } catch (error) {
            this.outputLogger.logMessage(`${(error as Error).message}`, "Error");
            return Promise.reject(new Error("error"));

        }
    }

    private get getDockerSettingsFilePath (): string {
        const homeDir = process.env.HOME || os.homedir();
        switch (process.platform) {
        case "win32":
            return path.join(homeDir, "AppData", "Roaming", "Docker", "settings-store.json");
        case "darwin":
            return path.join(homeDir, "Library", "Group Containers", "group.com.docker", "settings-store.json");
        case "linux":
            return path.join(homeDir, ".docker", "desktop", "settings-store.json");
        default:
            throw new Error("Unsupported operating system.");
        }
    }

}
