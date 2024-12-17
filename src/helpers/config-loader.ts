import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import yaml from "yaml";
import Config from "../model/Config.js";
import Constants from "../model/Constants.js";
import { getDockerSettingsFilePath } from "./docker-settings-config.js";

const fileVarRegExp = /^file:\/\/(.+)$/;

/**
 * Loads the configuration from the project root. When project does not contain
 * configuration then returns an empty configuration object.
 * @returns Project Config
 */
export const load: () => Config = () => {
    const projectPath = process.env.CHS_DEV_PROJECT || process.cwd();
    const confFile = join(projectPath, "chs-dev/config.yaml");
    const dockerSettingsPath:string = getDockerSettingsFilePath();

    let config: Partial<Config> = {};

    if (!existsSync(confFile)) {
        config = {
            env: {}
        };

    } else {
        const rawConfiguration = readFileSync(join(confFile)).toString("utf8");

        const projectConfiguration = yaml.parse(rawConfiguration);

        config = {
            env: parseEnv(projectConfiguration.env) || {},
            performEcrLoginHoursThreshold: projectConfiguration.authed_repositories && projectConfiguration.ecr_login_threshold_hours ? projectConfiguration.ecr_login_threshold_hours : undefined,
            versionSpecification: projectConfiguration.version
        };
    }

    if (!config.performEcrLoginHoursThreshold) {
        config = {
            ...config,
            performEcrLoginHoursThreshold: Constants.DEFAULT_PERFORM_ECR_LOGIN_HOURS_THRESHOLD
        };
    }

    return {
        ...config,
        projectPath,
        projectName: basename(projectPath),
        dockerSettingsPath
    } as Config;
};

const parseEnv = (env: Record<string, string> | undefined) => {
    if (!env) {
        return undefined;
    }

    return Object.keys(env)
        .map(key => {
            const value = env[key];

            const fileMatches = fileVarRegExp.exec(value);

            if (fileMatches) {
                const file = fileMatches[1];

                if (file && existsSync(file)) {
                    return [key, readFileSync(file).toString("utf8")];
                }
            }

            return [key, value];
        })
        .reduce((previous, next) => {
            const [key, value] = next;

            previous[key] = value;

            return previous;
        }, {} as Record<string, string>);
};

export default load;
