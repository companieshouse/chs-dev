import { expect, jest } from "@jest/globals";
import fs, { Dirent } from "fs";
import { dirname } from "path";
import BuilderDockerComposeSpec from "../../src/model/BuilderDockerComposeSpec";
import { clearBuilders, getBuilder } from "../../src/state/builders";
import { generateBuilderSpec } from "../utils/docker-compose-spec";
import yaml from "yaml";

type EntryType = "file" | "directory" | "blockdevice"
    | "characterdevice" | "symboliclink" | "fifo" | "socket";

const direntMock: (entryName: string, path: string, entryType: EntryType) => Dirent = (entryName, path, entryType) => {
    return {
        name: entryName,
        path,
        parentPath: path,
        isFile: () => entryType.toLowerCase() === "file",
        isDirectory: () => entryType.toLowerCase() === "directory",
        isBlockDevice: () => entryType.toLowerCase() === "blockdevice",
        isCharacterDevice: () => entryType.toLowerCase() === "characterdevice",
        isSymbolicLink: () => entryType.toLowerCase() === "symboliclink",
        isFIFO: () => entryType.toLowerCase() === "fifo",
        isSocket: () => entryType.toLowerCase() === "socket"
    };
};

describe("getBuilder", () => {
    const readdirSyncSpy = jest.spyOn(fs, "readdirSync");
    const existsSyncSpy = jest.spyOn(fs, "existsSync");
    const readFileSyncSpy = jest.spyOn(fs, "readFileSync");

    beforeEach(() => {
        jest.resetAllMocks();

        readdirSyncSpy.mockReturnValue([
            direntMock("java", "local/builders", "directory"),
            direntMock("v1", "local/builders/java", "directory"),
            direntMock("builder.docker-compose.yaml", "local/builders/java/v1", "file"),
            direntMock("Dockerfile", "local/builders/java/v1", "file"),
            direntMock("v2", "local/builders/java", "directory"),
            direntMock("builder.docker-compose.yaml", "local/builders/java/v2", "file"),
            direntMock("builder.Dockerfile", "local/builders/java/v2", "file"),
            direntMock("Dockerfile", "local/builders/java/v2", "file"),
            direntMock("Dockerfile", "local/builders/java", "symboliclink"),
            direntMock("node", "local/builders", "directory"),
            direntMock("v1", "local/builders/node", "directory"),
            direntMock("builder.docker-compose.yaml", "local/builders/node/v1", "file"),
            direntMock("Dockerfile", "local/builders/node/v1", "file"),
            direntMock("v2", "local/builders/node", "directory"),
            direntMock("builder.docker-compose.yaml", "local/builders/node/v2", "file"),
            direntMock("builder.Dockerfile", "local/builders/node/v2", "file"),
            direntMock("Dockerfile", "local/builders/node/v2", "file"),
            direntMock("Dockerfile", "local/builders/node", "symboliclink")
        ]);

        existsSyncSpy.mockReturnValue(true);

        readFileSyncSpy.mockImplementation((path, options) => {
            const builderPath = dirname(path as string);

            return Buffer.from(generateBuilderSpec(builderPath, builderPath.includes("v2")), "utf8");
        });
    });

    it("reads builders directory", () => {
        getBuilder("./", "java", undefined);

        expect(readdirSyncSpy).toHaveBeenCalledWith(
            "local/builders",
            {
                recursive: true,
                withFileTypes: true
            }
        );

        clearBuilders();
    });

    it("reads each file in", () => {
        getBuilder("./", "java", undefined);

        expect(readFileSyncSpy).toHaveBeenCalledTimes(4);
        expect(readFileSyncSpy).toHaveBeenCalledWith(
            "local/builders/java/v1/builder.docker-compose.yaml"
        );
        expect(readFileSyncSpy).toHaveBeenCalledWith(
            "local/builders/java/v2/builder.docker-compose.yaml"
        );
        expect(readFileSyncSpy).toHaveBeenCalledWith(
            "local/builders/node/v1/builder.docker-compose.yaml"
        );
        expect(readFileSyncSpy).toHaveBeenCalledWith(
            "local/builders/node/v2/builder.docker-compose.yaml"
        );
    });

    it("returns latest builder when version is undefined", () => {
        const result = getBuilder("./", "java", undefined) as BuilderDockerComposeSpec;

        expect(result.name).toBe("java");
        expect(result.version).toBe("v2");
        expect(result.builderSpec).toEqual(
            generateBuilderSpec("local/builders/java/v2", true)
        );
    });

    for (const version of ["v1", "v2"]) {
        it(`returns correct builder when version is ${version}`, () => {
            const result = getBuilder("./", "node", version) as BuilderDockerComposeSpec;

            expect(result.name).toBe("node");
            expect(result.version).toBe(version);
            expect(result.builderSpec).toEqual(
                generateBuilderSpec(`local/builders/node/${version}`, version === "v2")
            );
        });
    }

    it("calls readdirSync once when called multiple times - i.e. results are cached", () => {
        clearBuilders();

        getBuilder("./", "java", undefined);
        getBuilder("./", "java", undefined);

        expect(readdirSyncSpy).toHaveBeenCalledTimes(1);
    });

    it("returns repository builder", () => {
        const expectedBuilderSpec = yaml.stringify({
            services: {
                "<service>": {
                    pull_policy: "build",
                    build: {
                        context: "<absolute_repository_path>",
                        args: {
                            // eslint-disable-next-line no-template-curly-in-string
                            SSH_PRIVATE_KEY: "${SSH_PRIVATE_KEY}",
                            // eslint-disable-next-line no-template-curly-in-string
                            SSH_PRIVATE_KEY_PASSPHRASE: "${SSH_PRIVATE_KEY_PASSPHRASE}"
                        }
                    },
                    develop: {
                        watch: [
                            {
                                path: ".touch",
                                action: "rebuild"
                            }
                        ]
                    }
                }
            }
        });

        const result = getBuilder("./", "repository", undefined);

        expect(result).toEqual({
            name: "repository",
            version: "v1",
            builderSpec: expectedBuilderSpec
        });
    });

    it("throws error when builder version does not exist", () => {
        expect(() => getBuilder("./", "java", "v3")).toThrowErrorMatchingSnapshot();
    });

    it("throws error when builder does not exist", () => {
        expect(() => getBuilder("./", "javascript", undefined)).toThrowErrorMatchingSnapshot();
    });

    for (const testCase of [undefined, ""]) {

        it(`returns repository builder when builder name is "${testCase}"`, () => {
            const expectedBuilderSpec = yaml.stringify({
                services: {
                    "<service>": {
                        pull_policy: "build",
                        build: {
                            context: "<absolute_repository_path>",
                            args: {
                                // eslint-disable-next-line no-template-curly-in-string
                                SSH_PRIVATE_KEY: "${SSH_PRIVATE_KEY}",
                                // eslint-disable-next-line no-template-curly-in-string
                                SSH_PRIVATE_KEY_PASSPHRASE: "${SSH_PRIVATE_KEY_PASSPHRASE}"
                            }
                        },
                        develop: {
                            watch: [
                                {
                                    path: ".touch",
                                    action: "rebuild"
                                }
                            ]
                        }
                    }
                }
            });

            const result = getBuilder("./", testCase, undefined);

            expect(result).toEqual({
                name: "repository",
                version: "v1",
                builderSpec: expectedBuilderSpec
            });
        });
    }
});
