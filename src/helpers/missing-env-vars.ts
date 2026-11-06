import { existsSync, readFileSync } from "fs";
import { join } from "path";
import Service from "../model/Service.js";
import { serviceEnvFilePath } from "./service-repository.js";

export type MissingEnvVars = Record<string, string[]>;

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}/g;

// ${VAR} and ${VAR:?msg} require a value; ${VAR:-default}, ${VAR-default} and ${VAR:+alt} do not
const isRequired = (modifier: string) => modifier === "" || /^:?\?/.test(modifier);

/**
 * Parses KEY=VALUE lines of an env file, ignoring blanks and comments
 */
export const parseEnvFile = (path: string): Record<string, string> => {
    if (!existsSync(path)) {
        return {};
    }

    return readFileSync(path, "utf8").split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#"))
        .reduce((vars, line) => {
            const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
            if (match) {
                vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
            }
            return vars;
        }, {} as Record<string, string>);
};

/**
 * Lists the variables a service env file requires from the environment, i.e.
 * the ${VAR} references with no default.
 */
export const requiredVariables = (envFile: string): string[] => {
    const required = new Set<string>();

    Object.values(parseEnvFile(envFile)).forEach(value => {
        for (const match of value.matchAll(REFERENCE)) {
            if (isRequired(match[2])) {
                required.add(match[1]);
            }
        }
    });

    return [...required];
};

/**
 * Loads the variables compose uses for interpolation: the files listed in
 * COMPOSE_ENV_FILES (later files win), the chs-dev config env, then the
 * process environment.
 */
export const loadInterpolationEnv = (
    projectPath: string, configEnv: Record<string, string> = {}
): Record<string, string | undefined> => {
    const composeEnvFiles = (configEnv.COMPOSE_ENV_FILES ?? process.env.COMPOSE_ENV_FILES ?? ".env")
        .split(",").map(file => file.trim()).filter(Boolean);

    return {
        ...composeEnvFiles.reduce(
            (vars, file) => ({ ...vars, ...parseEnvFile(join(projectPath, file)) }), {}
        ),
        ...configEnv,
        ...process.env
    };
};

/**
 * Finds, per service, the variables its repository env file requires which
 * are not defined anywhere in the interpolation environment.
 */
export const findMissingEnvVars = (
    projectPath: string, services: Pick<Service, "name" | "repository">[], configEnv: Record<string, string> = {}
): MissingEnvVars => {
    const env = loadInterpolationEnv(projectPath, configEnv);

    return services.reduce((missing, service) => {
        const absent = requiredVariables(join(projectPath, serviceEnvFilePath(service))).filter(name => typeof env[name] === "undefined");

        if (absent.length) {
            missing[service.name] = absent;
        }
        return missing;
    }, {} as MissingEnvVars);
};
