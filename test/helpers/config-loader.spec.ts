import { expect, jest } from "@jest/globals";
import fs from "fs";
import { load } from "../../src/helpers/config-loader";
import yaml from "yaml";
import { join } from "path";

describe("load", () => {

    const existsSyncMock = jest.spyOn(fs, "existsSync");
    const readFileSyncMock = jest.spyOn(fs, "readFileSync");
    const pwdMock = jest.spyOn(process, "cwd");

    const pwd = "/users/user/docker-chs";

    const fileSystem = {
        "~/.file-one": "foo bar",
        "./file-two.csv": "foo,bar\nbar,foo\n",
        "/users/user/file-two": "foo=bar"
    };

    beforeEach(() => {
        jest.resetAllMocks();

        pwdMock.mockReturnValue(pwd);
    });

    it("returns empty configuration when no configuration file exists", () => {
        existsSyncMock.mockReturnValue(false);

        expect(load()).toEqual({ env: {}, projectPath: pwd });
    });

    it("returns configuration file with environment when file exists with environment", () => {
        existsSyncMock.mockImplementation((path) => {
            if (path === join(pwd, "chs-dev/config.yaml")) {
                return true;
            }

            return (path as string) in fileSystem;
        });

        const configuration = {
            env: {
                ENV_VAR_ONE: "some_value",
                ENV_VAR_TWO: "some_other_value",
                ENV_VAR_THREE: "file://~/.file-one",
                ENV_VAR_FOUR: "file://./file-two.csv",
                ENV_VAR_FIVE: "file:///users/user/file-two",
                ENV_VAR_SIX: "file://~/.file-not-found"
            }
        };
        readFileSyncMock.mockImplementation((path, _) => {
            if (path === join(pwd, "chs-dev/config.yaml")) {
                return Buffer.from(yaml.stringify(configuration), "utf8");
            }

            return Buffer.from(fileSystem[(path as string)], "utf8");
        });

        expect(load()).toEqual({
            env: {
                ENV_VAR_ONE: "some_value",
                ENV_VAR_TWO: "some_other_value",
                ENV_VAR_THREE: "foo bar",
                ENV_VAR_FOUR: "foo,bar\nbar,foo\n",
                ENV_VAR_FIVE: "foo=bar",
                ENV_VAR_SIX: "file://~/.file-not-found"
            },
            projectPath: pwd
        });
    });
});