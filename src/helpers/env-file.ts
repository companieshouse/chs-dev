import { existsSync, readFileSync } from "fs";
import { parse } from "dotenv";

/**
 * Parses an env file, returning an empty object when it does not exist
 */
export const parseEnvFile = (path: string): Record<string, string> =>
    existsSync(path) ? parse(readFileSync(path)) : {};
