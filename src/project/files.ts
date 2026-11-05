import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export interface ProjectEntry {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}

/** The filesystem operations project preparation needs; injectable for tests. */
export interface ProjectFs {
    realpath(path: string): Promise<string>;
    readFile(path: string): Promise<string>;
    readdir(path: string): Promise<ProjectEntry[]>;
    writeFile(
        path: string,
        text: string,
        options: { flag: 'wx'; mode: number },
    ): Promise<void>;
    mkdir(
        path: string,
        options: { recursive?: boolean; mode: number },
    ): Promise<void>;
    access(path: string): Promise<void>;
    stat(path: string): Promise<{ isDirectory(): boolean }>;
    replaceFile?(path: string, text: string): Promise<void>;
}

export const nodeProjectFs: ProjectFs = {
    realpath: (path) => fs.realpath(path),
    readFile: (path) => fs.readFile(path, 'utf8'),
    readdir: (path) => fs.readdir(path, { withFileTypes: true }),
    writeFile: (path, text, options) => fs.writeFile(path, text, options),
    mkdir: async (path, options) => {
        await fs.mkdir(path, options);
    },
    access: (path) => fs.access(path),
    stat: (path) => fs.stat(path),
    replaceFile: async (path, text) => {
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
            await fs.rename(temporary, path);
        } finally {
            await fs.rm(temporary, { force: true });
        }
    },
};

export async function optionalFile(files: ProjectFs, path: string) {
    try {
        return await files.readFile(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw error;
    }
}
