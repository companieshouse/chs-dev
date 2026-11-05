import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const limit = Number(process.argv[2] ?? 20);

if (!Number.isSafeInteger(limit) || limit < 1 || process.argv.length > 3) {
    console.error('Usage: node scripts/file-length.mjs [positive limit]');
    process.exit(1);
}

function lineCount(text) {
    if (!text) return 0;

    return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
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
                lines: lineCount(text),
            };
        }),
);

results.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

console.log(' Lines  File');
for (const result of results.slice(0, limit)) {
    console.log(String(result.lines).padStart(6) + '  ' + result.file);
}
