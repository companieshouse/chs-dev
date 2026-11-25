import CONSTANTS from "../model/Constants.js";
import Service from "../model/Service.js";
import { EnvLayer, resolveServiceEnv } from "./ecs-env.js";

export type MissingEnvVars = Record<string, string[]>;

/**
 * Lists the shared env files from the COMPOSE_ENV_FILES entry of the chs-dev
 * config env (later files win), falling back to the defaults.
 */
export const sharedEnvFiles = (configEnv: Record<string, string> = {}): string[] => {
    const files = (configEnv.COMPOSE_ENV_FILES ?? "")
        .split(",")
        .map(file => file.trim())
        .filter(Boolean);

    return files.length ? files : CONSTANTS.DEFAULT_COMPOSE_ENV_FILES;
};

/**
 * Finds, per service, the variables referenced by the env layers given which
 * are not defined by any layer below them nor in the process environment.
 */
const findUnresolved = (
    projectPath: string, services: Pick<Service, "name" | "repository">[], configEnv: Record<string, string>, layers: EnvLayer[]
): MissingEnvVars =>
    services.reduce((missing, service) => {
        const { unresolved } = resolveServiceEnv(projectPath, service, sharedEnvFiles(configEnv), configEnv);
        const names = [...new Set(unresolved.filter(({ layer }) => layers.includes(layer)).map(({ name }) => name))];

        if (names.length) {
            missing[service.name] = names;
        }
        return missing;
    }, {} as MissingEnvVars);

/**
 * Variables required by the chs-dev.env of each service which are not defined
 * anywhere
 */
export const findMissingEnvVars = (
    projectPath: string, services: Pick<Service, "name" | "repository">[], configEnv: Record<string, string> = {}
): MissingEnvVars => findUnresolved(projectPath, services, configEnv, ["service"]);

/**
 * Variables referenced by the ECS env files (typically secrets added by Vault
 * when deploying to ECS) which are not defined anywhere
 */
export const findMissingEcsEnvVars = (
    projectPath: string, services: Pick<Service, "name" | "repository">[], configEnv: Record<string, string> = {}
): MissingEnvVars => findUnresolved(projectPath, services, configEnv, ["ecs-global", "ecs-service"]);
