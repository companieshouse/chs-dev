import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expandHome } from '../infrastructure/settings.js';

export async function packageVersion() {
    const root = new URL('../../', import.meta.url);
    const info = JSON.parse(
        await readFile(new URL('package.json', root), 'utf8'),
    );
    return String(info.version);
}

export async function legacyProject(
    env: NodeJS.ProcessEnv = process.env,
    cwd = process.cwd(),
) {
    const directory = resolve(expandHome(env.CHS_DEV_PROJECT || cwd));
    return realpath(directory).catch(() => directory);
}
