import { execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { EOL } from "os";
import { isAbsolute, join } from "path";
import CONSTANTS from "../model/Constants.js";
import Service from "../model/Service.js";
import { parseEnvFile } from "./env-file.js";
import { serviceEnvFilePath } from "./service-repository.js";

type ConfigEnv = Record<string, string>;
type ServiceRef = Pick<Service, "name" | "module" | "repository">;

export type EnvLayer = "ecs-global" | "shared" | "ecs-service" | "service";

export type UnresolvedReference = { name: string, layer: EnvLayer };

export type ResolvedServiceEnv = {
    env: Record<string, string>,
    unresolved: UnresolvedReference[]
};

// Marks the start of a reference which could not be resolved, so it can be
// left for docker compose to interpolate
const UNRESOLVED = "\u0000";

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+?=])([^}]*))?\}/g;

/**
 * Name of the ECS environment to mimic (ECS_ENV in the chs-dev config env or
 * the process environment), cidev by default
 */
export const ecsEnvName = (configEnv: ConfigEnv = {}): string =>
    configEnv.ECS_ENV || process.env.ECS_ENV || CONSTANTS.DEFAULT_ECS_ENV;

const ecsConfigRoot = (projectPath: string, configEnv: ConfigEnv): string => {
    const configured = configEnv.ECS_CONFIG_PATH || process.env.ECS_CONFIG_PATH || CONSTANTS.DEFAULT_ECS_CONFIG_PATH;

    return isAbsolute(configured) ? configured : join(projectPath, configured);
};

const ecsEnvironment = (configEnv: ConfigEnv) => {
    const name = ecsEnvName(configEnv);
    const environment = CONSTANTS.ECS_ENVIRONMENTS[name];

    if (!environment) {
        throw new Error(`Unknown ECS_ENV "${name}", expected one of: ${Object.keys(CONSTANTS.ECS_ENVIRONMENTS).join(", ")}`);
    }
    return environment;
};

/**
 * Directory holding the env files of the selected ECS environment
 */
export const ecsEnvDirectory = (projectPath: string, configEnv: ConfigEnv = {}): string =>
    join(ecsConfigRoot(projectPath, configEnv), ecsEnvironment(configEnv).repository, ecsEnvironment(configEnv).directory);

/**
 * Updates (git pull) the clone of the ECS config repository used by the
 * selected ECS environment. Returns a description of why it was not updated,
 * undefined when it was.
 */
export const updateEcsConfig = (projectPath: string, configEnv: ConfigEnv = {}): string | undefined => {
    const repository = join(ecsConfigRoot(projectPath, configEnv), ecsEnvironment(configEnv).repository);

    if (!existsSync(join(repository, ".git"))) {
        return `${repository} is not a git clone of the ECS config repository`;
    }

    try {
        execFileSync("git", ["-C", repository, "pull", "--ff-only"], { stdio: "ignore" });
        return undefined;
    } catch (error) {
        return `git pull failed in ${repository}: ${(error as Error).message}`;
    }
};

/**
 * Expands the ${VAR}, ${VAR:-default}, ${VAR-default} and ${VAR:+alternative}
 * references of a value. References to variables which are not defined, and
 * have no default, are left in place (marked) and reported through unresolved.
 */
const expand = (value: string, vars: Record<string, string | undefined>, unresolved: string[]): string =>
    value.replace(REFERENCE, (_, name: string, operator: string | undefined, operand: string | undefined) => {
        const current = vars[name];
        const isSet = operator?.startsWith(":") ? !!current : typeof current !== "undefined";

        switch (operator?.replace(":", "")) {
        case "-":
        case "=":
            return isSet ? current! : expand(operand ?? "", vars, unresolved);
        case "+":
            return isSet ? expand(operand ?? "", vars, unresolved) : "";
        default:
            if (typeof current === "undefined") {
                unresolved.push(name);
                return `${UNRESOLVED}{${name}${operator ?? ""}${operand ?? ""}}`;
            }
            return current;
        }
    });

/**
 * Applies an env file on top of the variables so far: each value is expanded
 * against the variables so far (including the file's own earlier entries), so
 * that a service file can build upon the values of the layers below it.
 */
const applyLayer = (
    vars: Record<string, string>, entries: Record<string, string>, layer: EnvLayer, unresolved: UnresolvedReference[]
): Record<string, string> => {
    const result = { ...vars };

    Object.entries(entries).forEach(([key, value]) => {
        const missing: string[] = [];

        result[key] = expand(value, { ...process.env, ...result }, missing);
        missing.forEach(name => unresolved.push({ name, layer }));
    });

    return result;
};

/**
 * Resolves the env of a service, in increasing order of precedence:
 *
 * 1. global_vars.env of the ECS environment
 * 2. the shared project env files (global.env, .env - where the secrets
 *    retrieved from the param store end up)
 * 3. <service>.env of the ECS environment (can use all of the above)
 * 4. chs-dev.env of the service's repository
 */
export const resolveServiceEnv = (
    projectPath: string, service: Pick<Service, "name" | "repository">, sharedFiles: string[], configEnv: ConfigEnv = {}
): ResolvedServiceEnv => {
    const ecsDirectory = ecsEnvDirectory(projectPath, configEnv);
    const unresolved: UnresolvedReference[] = [];

    let env = applyLayer({}, parseEnvFile(join(ecsDirectory, CONSTANTS.ECS_GLOBAL_ENV_FILE)), "ecs-global", unresolved);

    env = sharedFiles.reduce(
        (vars, file) => applyLayer(vars, parseEnvFile(join(projectPath, file)), "shared", unresolved), env
    );
    env = applyLayer(env, parseEnvFile(join(ecsDirectory, `${service.name}.env`)), "ecs-service", unresolved);
    env = applyLayer(env, parseEnvFile(join(projectPath, serviceEnvFilePath(service))), "service", unresolved);

    return { env, unresolved };
};

// Single quotes keep compose from interpolating; unresolved references are
// left unquoted-escaped for compose to resolve
const formatValue = (value: string): string => {
    if (!value.includes(UNRESOLVED)) {
        return value.includes("'") || /[\r\n]/.test(value)
            ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\$/g, "$$$$").replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`
            : `'${value}'`;
    }

    const escaped = value
        .split(UNRESOLVED)
        .map((part, index) => index === 0 ? part.replace(/\$/g, "$$$$") : `\${${part.replace(/^\{/, "").replace(/\$/g, "$$$$")}`)
        .join("");

    return `"${escaped.replace(/"/g, "\\\"")}"`;
};

/**
 * Path of the generated env file of a service
 */
export const generatedEnvFilePath = (projectPath: string, service: Pick<Service, "name">): string =>
    join(projectPath, CONSTANTS.ENV_OVERRIDES_DIRECTORY, `${service.name}.env`);

/**
 * Writes the resolved env of the service, returning its path (undefined, with
 * nothing written, when there are no variables) and what could not be
 * resolved.
 */
export const writeServiceEnvFile = (
    projectPath: string, service: ServiceRef, sharedFiles: string[], configEnv: ConfigEnv = {}
): { path?: string, unresolved: UnresolvedReference[] } => {
    const { env, unresolved } = resolveServiceEnv(projectPath, service, sharedFiles, configEnv);

    if (!Object.keys(env).length) {
        return { unresolved };
    }

    const path = generatedEnvFilePath(projectPath, service);

    mkdirSync(join(projectPath, CONSTANTS.ENV_OVERRIDES_DIRECTORY), { recursive: true });
    writeFileSync(path, [
        "# DO NOT MODIFY THIS FILE MANUALLY - this file is generated automatically and changes may be lost",
        ...Object.entries(env).map(([key, value]) => `${key}=${formatValue(value)}`),
        ""
    ].join(EOL));

    return { path, unresolved };
};
