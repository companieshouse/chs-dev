import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import yaml from "yaml";
import Config from "../model/Config.js";

const fileVarRegExp = /^file:\/\/(.+)$/;
const DEFAULT_PERFORM_ECR_LOGIN_HOURS_THRESHOLD = 8;

/**
 * Loads the configuration from the project root. When project does not contain
 * configuration then returns an empty configuration object.
 * @returns Project Config
 */
export const load: () => Config = () => {
    const projectPath = process.cwd();
    const confFile = join(projectPath, "chs-dev/config.yaml");

    let config: Partial<Config> = {};

    if (!existsSync(confFile)) {
        config = {
            env: {},
            projectPath,
            projectName: basename(projectPath),
            authenticatedRepositories: []
        };

    } else {
        const rawConfiguration = readFileSync(join(confFile)).toString("utf8");

        const projectConfiguration = yaml.parse(rawConfiguration);

        config = {
            env: parseEnv(projectConfiguration.env) || {},
            projectPath,
            projectName: basename(projectPath),
            authenticatedRepositories: projectConfiguration.authed_repositories || [],
            performEcrLoginHoursThreshold: projectConfiguration.authed_repositories && projectConfiguration.ecr_login_threshold_hours ? projectConfiguration.ecr_login_threshold_hours : undefined
        };
    }

    if (config.authenticatedRepositories && config.authenticatedRepositories.length > 0 && !config.performEcrLoginHoursThreshold) {
        config = {
            ...config,
            performEcrLoginHoursThreshold: DEFAULT_PERFORM_ECR_LOGIN_HOURS_THRESHOLD
        };
    }

    return config as Config;
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
