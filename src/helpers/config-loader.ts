import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import Config from "../model/Config.js";

const fileVarRegExp = /^file:\/\/(.+)$/;

/**
 * Loads the configuration from the project root. When project does not contain
 * configuration then returns an empty configuration object.
 * @returns Project Config
 */
export const load: () => Config = () => {
    const projectPath = process.cwd();
    const confFile = join(projectPath, "chs-dev/config.yaml");

    if (!existsSync(confFile)) {
        return {
            env: {},
            projectPath
        };

    } else {
        const rawConfiguration = readFileSync(join(confFile)).toString("utf8");

        const configuration = parse(rawConfiguration);

        return {
            env: parseEnv(configuration.env) || {},
            projectPath
        };
    }
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
