import { readFile } from 'node:fs/promises';
export async function optionalJson<T>(path: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw error;
    }
}
