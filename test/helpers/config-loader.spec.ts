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

    const originalProcessEnv = {
        ...process.env
    };

    const fileSystem = {
        "~/.file-one": "foo bar",
        "./file-two.csv": "foo,bar\nbar,foo\n",
        "/users/user/file-two": "foo=bar"
    };

    beforeEach(() => {
        jest.resetAllMocks();

        pwdMock.mockReturnValue(pwd);

        process.env = originalProcessEnv;
    });

    it("returns empty configuration when no configuration file exists", () => {
        existsSyncMock.mockReturnValue(false);

        expect(load()).toEqual({ projectName: "docker-chs", env: {}, projectPath: pwd, authenticatedRepositories: [] });
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
            },
            authed_repositories: [
                "123456789.dkr.eu-west-2.amazonaws.com"
            ]
        };
        readFileSyncMock.mockImplementation((path, _) => {
            if (path === join(pwd, "chs-dev/config.yaml")) {
                return Buffer.from(yaml.stringify(configuration), "utf8");
            }

            return Buffer.from(fileSystem[(path as string)], "utf8");
        });

        expect(load()).toEqual({
            projectName: "docker-chs",
            env: {
                ENV_VAR_ONE: "some_value",
                ENV_VAR_TWO: "some_other_value",
                ENV_VAR_THREE: "foo bar",
                ENV_VAR_FOUR: "foo,bar\nbar,foo\n",
                ENV_VAR_FIVE: "foo=bar",
                ENV_VAR_SIX: "file://~/.file-not-found"
            },
            projectPath: pwd,
            authenticatedRepositories: [
                "123456789.dkr.eu-west-2.amazonaws.com"
            ],
            performEcrLoginHoursThreshold: 8
        });
    });

    it("returns defined login threshold", () => {
        existsSyncMock.mockReturnValue(true);

        const configuration = {
            env: {},
            authed_repositories: [
                "123456789.dkr.eu-west-2.amazonaws.com"
            ],
            ecr_login_threshold_hours: 7
        };

        readFileSyncMock.mockReturnValue(
            Buffer.from(yaml.stringify(configuration), "utf8")
        );

        expect(load()).toEqual({
            env: {},
            projectPath: pwd,
            projectName: "docker-chs",
            authenticatedRepositories: ["123456789.dkr.eu-west-2.amazonaws.com"],
            performEcrLoginHoursThreshold: 7
        });
    });

    it("returns configuration with versionSpecification when defined in project", () => {
        existsSyncMock.mockReturnValue(true);

        const configuration = {
            env: {},
            authed_repositories: [],
            version: ">1.0 <2.0"
        };

        readFileSyncMock.mockReturnValue(
            Buffer.from(yaml.stringify(configuration), "utf8")
        );

        expect(load()).toEqual({
            env: {},
            projectPath: pwd,
            projectName: "docker-chs",
            authenticatedRepositories: [],
            versionSpecification: ">1.0 <2.0"
        });
    });

    it("can load project path from CHS_DEV_PROJECT environment var", () => {
        const chsDevProjectPath = "/users/user/chs-docker-project";

        process.env = {
            ...process.env,
            CHS_DEV_PROJECT: chsDevProjectPath
        };

        existsSyncMock.mockReturnValue(false);

        expect(load()).toEqual({ projectName: "chs-docker-project", env: {}, projectPath: chsDevProjectPath, authenticatedRepositories: [] });
    });
});
