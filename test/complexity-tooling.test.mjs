import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import {
    mkdtemp,
    mkdir,
    copyFile,
    writeFile,
    symlink,
    rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd: root, allowInlineConfig: false });

test('correctness checks reject unsafe promises, equality and missing callback returns', async () => {
    const [result] = await eslint.lintText(
        `
            new Promise(async (resolve) => { resolve(1); });
            new Promise((resolve) => setTimeout(resolve, 10));
            const compare = (a, b) => a == b;
            [1].map((value) => { console.log(value); });
        `,
        { filePath: 'src/probe.ts' },
    );
    assert.deepEqual(
        new Set(result.messages.map((message) => message.ruleId)),
        new Set([
            'no-async-promise-executor',
            'no-promise-executor-return',
            'eqeqeq',
            'array-callback-return',
        ]),
    );
    assert.ok(result.messages.every((message) => message.severity === 2));
});

test('domain imports and conditional hooks are rejected', async () => {
    const [domain] = await eslint.lintText(
        "import type { Adapter } from '../infrastructure/adapter.js';",
        { filePath: 'src/domain/probe.ts' },
    );
    assert.equal(domain.messages[0].ruleId, 'no-restricted-imports');
    const [hooks] = await eslint.lintText(
        `import { useState } from 'react';
         export function Probe({ active }) { if (active) useState(0); return null; }`,
        { filePath: 'src/tui/probe.tsx' },
    );
    assert.equal(hooks.messages[0].ruleId, 'react-hooks/rules-of-hooks');
    assert.equal(hooks.messages[0].severity, 2);
});

test('complexity rules detect all six signals in TypeScript', async () => {
    const source = `
        interface Handler { run: (value: string) => void }
        export const identity = <T>(value: T) => value;
        export function complicated(a: number, b: number, c: number, d: number, e: number, f: number) {
            ${Array.from({ length: 16 }, (_, i) => `if (a === ${i}) b++;`).join('\n')}
            if (a) { if (b) { if (c) { if (d) { if (e) { f++; } } } } }
            [a].map(() => [b].map(() => [c].map(() => [d].map(() => e))));
            ${'a++;\n'.repeat(101)}
            return a;
        }
    `;
    const [result] = await eslint.lintText(source, {
        filePath: 'src/probe.ts',
    });
    assert.equal(result.errorCount, 0);
    assert.deepEqual(
        new Set(result.messages.map((m) => m.ruleId)),
        new Set([
            'complexity',
            'max-depth',
            'local/combined-nesting',
            'max-lines-per-function',
            'max-nested-callbacks',
            'max-params',
        ]),
    );
});

test('JSX nesting is not treated as control-flow nesting', async () => {
    const [result] = await eslint.lintText(
        'export const View = () => <A><B><C><D><E><F /></E></D></C></B></A>;',
        { filePath: 'src/probe.tsx' },
    );
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 0);
});

test('baseline accepts existing findings and rejects new findings and parse failures', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'chs-complexity-'));
    try {
        await mkdir(join(fixture, 'scripts', 'eslint-rules'), {
            recursive: true,
        });
        await copyFile(
            join(root, 'scripts/eslint-rules/combined-nesting.mjs'),
            join(fixture, 'scripts/eslint-rules/combined-nesting.mjs'),
        );
        await mkdir(join(fixture, 'src'));
        await copyFile(
            join(root, 'scripts/complexity.mjs'),
            join(fixture, 'scripts/complexity.mjs'),
        );
        await copyFile(
            join(root, 'eslint.config.mjs'),
            join(fixture, 'eslint.config.mjs'),
        );
        await symlink(
            join(root, 'node_modules'),
            join(fixture, 'node_modules'),
            'dir',
        );
        const run = (mode) =>
            spawnSync(process.execPath, ['scripts/complexity.mjs', mode], {
                cwd: fixture,
                encoding: 'utf8',
            });
        const warning = 'export function many(a,b,c,d,e,f) { return a; }';
        await writeFile(join(fixture, 'src/probe.ts'), warning);
        assert.equal(run('baseline').status, 0);
        assert.equal(run('check').status, 0);
        const report = run('json');
        assert.equal(report.status, 0);
        assert.equal(JSON.parse(report.stdout)[0].rule, 'max-params');
        await writeFile(join(fixture, 'src/extra.ts'), warning);
        const increase = run('check');
        assert.equal(increase.status, 1);
        assert.match(increase.stderr, /extra.ts\|max-params/);
        await writeFile(
            join(fixture, 'src/extra.ts'),
            'export function run() { listen(() => { while (ready()) { listen(() => { if (ok()) work(); }); } }); }',
        );
        const combined = run('check');
        assert.equal(combined.status, 1);
        assert.match(combined.stderr, /extra.ts\|local\/combined-nesting/);
        assert.deepEqual(
            JSON.parse(run('json').stdout)
                .filter((finding) => finding.file === 'src/extra.ts')
                .map((finding) => finding.rule),
            ['local/combined-nesting'],
        );
        await writeFile(
            join(fixture, 'src/extra.ts'),
            'function handle() { if (ok()) work(); } export function run() { listen(() => { while (ready()) { listen(handle); } }); }',
        );
        assert.equal(run('check').status, 0);
        await writeFile(
            join(fixture, 'src/extra.ts'),
            'export function broken(',
        );
        assert.equal(run('check').status, 1);
        assert.equal(run('baseline').status, 1);
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

test('strict complexity, function length and depth limits reject exactly the first excess', async () => {
    const complexity = (branches) =>
        `export function probe(value) { ${'if (value) value--;\n'.repeat(branches)} return value; }`;
    const length = (lines) =>
        `export function probe(value) {\n${'value++;\n'.repeat(lines - 2)}}`;
    const depth = (levels) =>
        `export function probe(value) { ${'if (value) {'.repeat(levels)} value++; ${'}'.repeat(levels)} }`;
    for (const [make, limit, rule] of [
        [complexity, 9, 'complexity'],
        [length, 80, 'max-lines-per-function'],
        [depth, 3, 'max-depth'],
    ]) {
        const [accepted] = await eslint.lintText(make(limit), {
            filePath: 'src/probe.ts',
        });
        assert.deepEqual(accepted.messages, []);
        const [rejected] = await eslint.lintText(make(limit + 1), {
            filePath: 'src/probe.ts',
        });
        assert.deepEqual(
            rejected.messages
                .filter(
                    (message) => message.ruleId !== 'local/combined-nesting',
                )
                .map((message) => message.ruleId),
            [rule],
        );
    }
});
