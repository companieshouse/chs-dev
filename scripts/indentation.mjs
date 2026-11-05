import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const limit = Number(process.argv[2] ?? 20);

if (!Number.isSafeInteger(limit) || limit < 1 || process.argv.length > 3) {
    console.error('Usage: node scripts/indentation.mjs [positive limit]');
    process.exit(1);
}

function maximumIndent(text) {
    let spaces = -1;
    let line = 0;

    for (const [index, content] of text.split(/\r?\n/).entries()) {
        if (!content.trim()) continue;

        const leadingSpaces = content.match(/^ */)[0].length;
        if (leadingSpaces <= spaces) continue;

        spaces = leadingSpaces;
        line = index + 1;
    }

    return { spaces: Math.max(0, spaces), line };
}

const entries = await readdir(source, { recursive: true, withFileTypes: true });
const results = await Promise.all(
    entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
            const path = join(entry.parentPath, entry.name);
            const text = await readFile(path, 'utf8');

            return {
                file: 'src/' + relative(source, path).replaceAll('\\', '/'),
                ...maximumIndent(text),
            };
        }),
);

results.sort((a, b) => b.spaces - a.spaces || a.file.localeCompare(b.file));

console.log('Spaces  File:line');
for (const result of results.slice(0, limit)) {
    console.log(
        String(result.spaces).padStart(6) +
            '  ' +
            result.file +
            ':' +
            (result.line || '-'),
    );
}
