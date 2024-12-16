import * as os from "os";
import * as path from "path";

const windowsDockerSettingsDir = "AppData/Roaming/Docker/settings-store.json";
const macDockerSettingsDir = "Library/Group Containers/group.com.docker/settings-store.json";
const linuxDockerSettingsDir = ".docker/desktop/settings-store.json";

export const getDockerSettingsFilePath = (): string => {
    const homeDir = process.env.HOME || os.homedir();
    switch (process.platform) {
    case "win32":
        return path.join(homeDir, windowsDockerSettingsDir);
    case "darwin":
        return path.join(homeDir, macDockerSettingsDir);
    case "linux":
        return path.join(homeDir, linuxDockerSettingsDir);
    default:
        throw new Error("Unsupported operating system.");
    }
};
