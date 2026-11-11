import { existsSync, readFileSync } from "fs";
import { parse } from "dotenv";
import { join } from "path";
import Service from "../model/Service.js";
import { serviceEnvFilePath } from "./service-repository.js";

export type MissingEnvVars = Record<string, string[]>;

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}/g;

// ${VAR} and ${VAR:?msg} require a value; ${VAR:-default}, ${VAR-default} and ${VAR:+alt} do not
const isRequired = (modifier: string) => modifier === "" || /^:?\?/.test(modifier);

/**
 * Parses an env file, returning an empty object when it does not exist
 */
export const parseEnvFile = (path: string): Record<string, string> =>
    existsSync(path) ? parse(readFileSync(path)) : {};

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
