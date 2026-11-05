import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function privateJson(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(value), {
            mode: 0o600,
            flag: 'wx',
        });
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}
export async function optionalJson<T>(path: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw error;
    }
}
