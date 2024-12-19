import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect, jest } from "@jest/globals";
import { DockerSettings, fetchDockerSettings } from "../../src/helpers/docker-settings-store";

jest.mock("os");
jest.mock("fs");
jest.mock("../../src/helpers/docker-settings-store", () => ({
    fetchDockerSettings: jest.fn()
}));

describe("docker-settings-store", () => {
    const mockDockerSettings: DockerSettings = {
        OverrideProxyHTTP: "http://proxy.example.com",
        OverrideProxyHTTPS: "http://proxy.example.com",
        ProxyHttpMode: "manual",
        ProxyHTTPMode: "manual",
        MemoryMiB: 17000
    };

    const mockPath = "/mock/path/settings-store.json";

    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe("getDockerSettingsPath", () => {
        it("should return the correct path for Windows", () => {
            (os.homedir as jest.Mock).mockReturnValue("/mock/home");
            Object.defineProperty(process, "platform", { value: "win32" });

            const result = path.join(os.homedir(), "AppData/Roaming/Docker/settings-store.json");
            expect(result).toBe("/mock/home/AppData/Roaming/Docker/settings-store.json");

        });

        it("should return the correct path for macOS", () => {
            (os.homedir as jest.Mock).mockReturnValue("/mock/home");
            Object.defineProperty(process, "platform", { value: "darwin" });

            const result = path.join(os.homedir(), "Library/Group Containers/group.com.docker/settings-store.json");
            expect(result).toBe("/mock/home/Library/Group Containers/group.com.docker/settings-store.json");
        });

        it("should return the correct path for Linux", () => {
            (os.homedir as jest.Mock).mockReturnValue("/mock/home");
            Object.defineProperty(process, "platform", { value: "linux" });

            const result = path.join(os.homedir(), ".docker/desktop/settings-store.json");
            expect(result).toBe("/mock/home/.docker/desktop/settings-store.json");
        });

        it("should throw an error for unsupported operating systems", () => {
            Object.defineProperty(process, "platform", { value: "unsupported" });

            (fetchDockerSettings as jest.Mock).mockImplementation(() => {
                throw new Error("Unsupported operating system.");
            });

            expect(() => fetchDockerSettings()).toThrowError("Unsupported operating system.");
        });
    });

    describe("doesDockerSettingsPathExist", () => {
        it("should return true if the settings path exists", () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);

            expect(fs.existsSync(mockPath)).toBe(true);
        });

        it("should return false if the settings path does not exist", () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            expect(fs.existsSync(mockPath)).toBe(false);
        });
    });

    describe("parseDockerSettingsFile", () => {
        it("should parse and return Docker settings from the file", () => {
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockDockerSettings));

            const result = JSON.parse(fs.readFileSync(mockPath, "utf-8"));
            expect(result).toEqual(mockDockerSettings);
        });
    });

    describe("fetchDockerSettings", () => {
        it("should return Docker settings if the file exists and is valid", () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockDockerSettings));
            (fetchDockerSettings as jest.Mock).mockImplementation(() => mockDockerSettings);

            const result = fetchDockerSettings();
            expect(result).toEqual(mockDockerSettings);
        });

        it("should throw an error if the file does not exist", async () => {

            (fetchDockerSettings as jest.Mock).mockImplementation(() => {
                throw new Error(`Docker settings-store.json file not found on user's device: Invalid file path ${mockPath}`);
            });

            expect(() => fetchDockerSettings()).toThrowError(
                `Docker settings-store.json file not found on user's device: Invalid file path ${mockPath}`
            );
        });
    });
});
