import { chmod, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Published node-pty archives can lose the executable bit on the macOS helper.
if (process.platform === 'darwin') {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve('node-pty/package.json'));
    async function prepare(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await prepare(path);
            else if (entry.isFile() && entry.name === 'spawn-helper') {
                const info = await stat(path);
                await chmod(path, info.mode | 0o111);
            }
        }
    }
    await prepare(root);
}
