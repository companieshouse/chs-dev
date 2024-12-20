import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const DOCKER_SETTINGS_PATH_WINDOWS = "AppData/Roaming/Docker/settings-store.json";
const DOCKER_SETTINGS_PATH_MAC = "Library/Group Containers/group.com.docker/settings-store.json";
const DOCKER_SETTINGS_PATH_LINUX = ".docker/desktop/settings-store.json";

export type DockerSettings = {
    OverrideProxyHTTP: string;
    OverrideProxyHTTPS: string;
    ProxyHttpMode: string
    ProxyHTTPMode: string
    MemoryMiB: number;
}

type DockerSettingsIssue = {
    title: string;
    description: string;
    suggestions: string[];
    documentationLinks: string[];
}

const getSettingsPath = (): string => {
    const homeDir = process.env.HOME || os.homedir();
    switch (process.platform) {
    case "win32":
        return path.join(homeDir, DOCKER_SETTINGS_PATH_WINDOWS);
    case "darwin":
        return path.join(homeDir, DOCKER_SETTINGS_PATH_MAC);
    case "linux":
        return path.join(homeDir, DOCKER_SETTINGS_PATH_LINUX);
    default:
        throw new Error("Unsupported operating system.");
    }
};

const isSettingsPathSet = (settingsPath: string): boolean => {
    return !!fs.existsSync(settingsPath);
};

const parseDockerSettingsFile = (settingsPath: string): DockerSettings => {
    const fileContents = fs.readFileSync(settingsPath, "utf-8");
    return JSON.parse(fileContents);
};

export const fetchDockerSettings = (): DockerSettings| DockerSettingsIssue => {
    const settingsPath = getSettingsPath();
    const isPathSet = isSettingsPathSet(settingsPath);
    if (isPathSet) {
        return parseDockerSettingsFile(settingsPath);
    } else {
        return {
            title: "Docker settings-store.json file not found on user's device",
            description: `invalid file path ${settingsPath}. Docker settings check will fail to validate failed`,
            suggestions: ["Rerun docker setup and reinstall docker with the dev-env-setup tool"],
            documentationLinks: []
        }; ;
    }

};
