import { ESLint } from 'eslint';
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselinePath = new URL('../complexity-baseline.json', import.meta.url);
const mode = process.argv[2] ?? 'report';
if (!['report', 'check', 'baseline', 'json'].includes(mode)) {
    throw new Error(
        'Usage: node scripts/complexity.mjs [report|check|baseline|json]',
    );
}
const results = await new ESLint({
    cwd: root,
    allowInlineConfig: false,
}).lintFiles(['src/**/*.{ts,tsx}']);
const errors = results.flatMap((result) =>
    result.messages.filter((message) => message.severity === 2),
);
if (errors.length) {
    console.error(
        await (await new ESLint().loadFormatter('stylish')).format(results),
    );
    process.exitCode = 1;
} else {
    const suggestions = {
        'max-depth': 'Use guard clauses or extract a nested operation.',
        'local/combined-nesting':
            'Separate callback handling from parsing or policy; preserve the operation boundary.',
        complexity: 'Split decision paths into cohesive operations.',
        'max-lines-per-function':
            'Separate responsibilities; review JSX layout separately.',
        'max-nested-callbacks':
            'Extract named callbacks or simplify the async flow.',
        'max-params': 'Group related inputs or split responsibilities.',
    };
    const findings = results.flatMap((result) =>
        result.messages
            .filter((message) => Object.hasOwn(suggestions, message.ruleId))
            .map((message) => ({
                file: relative(root, result.filePath).replaceAll('\\', '/'),
                line: message.line,
                rule: message.ruleId,
                message: message.message,
                suggestion: suggestions[message.ruleId],
            })),
    );
    const counts = {};
    for (const finding of findings) {
        const key = finding.file + '|' + finding.rule;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    const snapshot = {
        version: 1,
        counts: Object.fromEntries(Object.entries(counts).sort()),
    };
    if (mode === 'baseline') {
        await writeFile(baselinePath, JSON.stringify(snapshot, null, 4) + '\n');
        console.log(
            'Recorded ' +
                findings.length +
                ' warnings in complexity-baseline.json.',
        );
    } else if (mode === 'check') {
        const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
        if (baseline.version !== 1 || !baseline.counts)
            throw new Error('Invalid complexity baseline.');
        const increases = Object.entries(counts).filter(
            ([key, count]) => count > (baseline.counts[key] ?? 0),
        );
        for (const [key, count] of increases)
            console.error(
                key +
                    ': ' +
                    count +
                    ' warnings (baseline ' +
                    (baseline.counts[key] ?? 0) +
                    ')',
            );
        if (increases.length) process.exitCode = 1;
        else
            console.log(
                'Complexity check passed (' +
                    findings.length +
                    ' existing warnings).',
            );
    } else if (mode === 'json') {
        console.log(JSON.stringify(findings, null, 4));
    } else {
        const fileScores = {};
        for (const finding of findings)
            fileScores[finding.file] = (fileScores[finding.file] ?? 0) + 1;
        findings.sort(
            (a, b) =>
                fileScores[b.file] - fileScores[a.file] ||
                a.file.localeCompare(b.file) ||
                a.line - b.line,
        );
        console.log(
            findings.length + ' warnings; files ranked by warning count.\n',
        );
        for (const finding of findings) {
            console.log(
                finding.file +
                    ':' +
                    finding.line +
                    ' [' +
                    finding.rule +
                    '] ' +
                    finding.message,
            );
            console.log('  ' + finding.suggestion);
        }
    }
}
