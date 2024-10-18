import { expect, jest } from "@jest/globals";
import { OutputTroubleshootArtifactContext } from "../../../../src/run/troubleshoot/artifact/TroubleshootArtifactContext";
import fs from "fs";
import { join } from "path";

describe("OutputTroubleshootArtifactContext", () => {
    const writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");

    let outputTroubleshootArtifactContext: OutputTroubleshootArtifactContext;

    const config = {
        projectPath: "/home/user/docker-proj",
        projectName: "docker-proj",
        env: {
            SSH_PRIVATE_KEY: "---BEGIN OPENSSH PRIVATE KEY ----\n",
            SSH_PRIVATE_KEY_PASSPHRASE: "Bananas1234"
        }
    };

    const redactedConfig = {
        ...config,
        env: {
            SSH_PRIVATE_KEY: "<REDACTED>",
            SSH_PRIVATE_KEY_PASSPHRASE: "<REDACTED>"
        }
    };

    const outputDirectory = "/tmp/chs-dev-12345";
    beforeEach(() => {
        jest.resetAllMocks();

        outputTroubleshootArtifactContext = new OutputTroubleshootArtifactContext(
            config,
            outputDirectory
        );

        writeFileSyncSpy.mockReturnValue(undefined);
    });

    it("contains chs dev config", () => {
        // @ts-expect-error
        expect(outputTroubleshootArtifactContext.context).toEqual({
            config: redactedConfig
        });
    });

    it("append adds additional item", () => {
        outputTroubleshootArtifactContext.append({
            "another-item": {
                foo: "bar",
                bar: true
            }
        });

        // @ts-expect-error
        expect(outputTroubleshootArtifactContext.context).toEqual({
            config: redactedConfig,
            "another-item": {
                foo: "bar",
                bar: true
            }
        });
    });

    it("append overrwrites content", () => {
        outputTroubleshootArtifactContext.append({
            "another-item": {
                foo: "bar",
                bar: true
            }
        });

        outputTroubleshootArtifactContext.append({
            "another-item": "overwritten"
        });

        // @ts-expect-error
        expect(outputTroubleshootArtifactContext.context).toEqual({
            config: redactedConfig,
            "another-item": "overwritten"
        });
    });

    it("append will throw error when trying to overwrite config", () => {
        expect(() => outputTroubleshootArtifactContext.append({ config })).toThrowError("Cannot overwrite initial config");
    });

    it("append can append multiple attributes", () => {
        outputTroubleshootArtifactContext.append({
            "another-item": {
                foo: "bar",
                bar: true
            },
            "yet-another-item": {
                bar: false
            }
        });

        // @ts-expect-error
        expect(outputTroubleshootArtifactContext.context).toEqual({
            config: redactedConfig,
            "another-item": {
                foo: "bar",
                bar: true
            },
            "yet-another-item": {
                bar: false
            }
        });
    });

    it("write writes context to file", () => {
        outputTroubleshootArtifactContext.append({
            "another-item": {
                foo: "bar",
                bar: true
            }
        });

        outputTroubleshootArtifactContext.write();

        expect(writeFileSyncSpy).toHaveBeenCalledWith(
            join(outputDirectory, "context.json"),
            Buffer.from(JSON.stringify({
                config: redactedConfig,
                "another-item": {
                    foo: "bar",
                    bar: true
                }
            }), "utf8")
        );
    });
});
