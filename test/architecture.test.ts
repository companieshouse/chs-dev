import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('frontend, application and protocol imports respect the daemon boundary', async () => {
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    async function check(directory: string, forbidden: RegExp) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await check(path, forbidden);
            else if (/\.tsx?$/.test(entry.name)) {
                const source = await readFile(path, 'utf8');
                const imports = [
                    ...source.matchAll(/(?:from\s+|import\s*\()(['"])(.*?)\1/g),
                ].map((match) => match[2]!);
                for (const dependency of imports)
                    assert.equal(
                        forbidden.test(dependency),
                        false,
                        `${path} imports ${dependency}`,
                    );
            }
        }
    }
    await check(
        join(root, 'tui'),
        /infrastructure\/|application\/|server\/|node:(fs|child_process|net|http)/,
    );
    await check(
        join(root, 'cli'),
        /infrastructure\/|application\/|server\/|ink|react|node:(fs|child_process|net|http)/,
    );
    await check(
        join(root, 'application'),
        /infrastructure\/|tui\/|server\/|ink|react|node:(fs|child_process|net|http)/,
    );
    await check(
        join(root, 'protocol'),
        /infrastructure\/|application\/|tui\/|server\/|ink|react/,
    );
});
