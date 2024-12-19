import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const WINDOWS_DOCKER_SETTINGS_PATH = "AppData/Roaming/Docker/settings-store.json";
const MAC_DOCKER_SETTINGS_PATH = "Library/Group Containers/group.com.docker/settings-store.json";
const LINUX_DOCKER_SETTINGS_PATH = ".docker/desktop/settings-store.json";

type DockerSettingsIssue = {
    title: string;
    description: string;
    suggestions: string[];
    documentationLinks: string[];
}

export type DockerSettings = {
    OverrideProxyHTTP: string;
    OverrideProxyHTTPS: string;
    ProxyHttpMode: string
    ProxyHTTPMode: string
    MemoryMiB: number;
}

const getDockerSettingsPath = (): string => {
    const homeDir = process.env.HOME || os.homedir();
    switch (process.platform) {
    case "win32":
        return path.join(homeDir, WINDOWS_DOCKER_SETTINGS_PATH);
    case "darwin":
        return path.join(homeDir, MAC_DOCKER_SETTINGS_PATH);
    case "linux":
        return path.join(homeDir, LINUX_DOCKER_SETTINGS_PATH);
    default:
        throw new Error("Unsupported operating system.");
    }
};

const doesDockerSettingsPathExist = (dkSettingsPath: string): boolean => {
    return !!fs.existsSync(dkSettingsPath);
};

const parseDockerSettingsFile = (dkSettingsPath: string): DockerSettings => {
    const fileContents = fs.readFileSync(dkSettingsPath, "utf-8");
    return JSON.parse(fileContents);
};

export const fetchDockerSettings = (): DockerSettings => {
    const dkSettingsPath = getDockerSettingsPath();
    const pathExist = doesDockerSettingsPathExist(dkSettingsPath);
    if (pathExist) {
        return parseDockerSettingsFile(dkSettingsPath);
    } else {
        throw new Error(`Docker settings-store.json file not found on user's device: Invalid file path ${dkSettingsPath}`);
    }

};
