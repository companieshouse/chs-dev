import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
    applyMutant,
    generateMutants,
} from '../scripts/mutation-operators.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const runner = join(project, 'scripts/mutation-test.mjs');

async function fixture(t, source, assertions) {
    const root = await mkdtemp(join(tmpdir(), 'chs-mutation-fixture-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'test'));
    // This fixture project forwards to the real Node test runner. An outer
    // test-local invocation supplies its sandbox; macOS cannot nest sandboxes.
    await writeFile(
        join(root, 'scripts/test-local.mjs'),
        `
        import { spawnSync } from 'node:child_process';
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], { stdio: 'inherit', env });
        process.exitCode = result.status ?? 1;
    `,
    );
    await symlink(
        join(project, 'node_modules'),
        join(root, 'node_modules'),
        'dir',
    );
    await writeFile(join(root, 'src/value.mjs'), source);
    await writeFile(
        join(root, 'test/value.test.mjs'),
        `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { value } from '../src/value.mjs';\n${assertions}\n`,
    );
    await writeFile(
        join(root, 'config.json'),
        JSON.stringify({
            name: 'fixture',
            files: ['src/value.mjs'],
            tests: ['test/value.test.mjs'],
            outputDirectory: 'results',
            timeoutMs: 3000,
        }),
    );
    return root;
}

function run(root, ...args) {
    const result = spawnSync(
        process.execPath,
        [runner, '--root', root, '--config', 'config.json', ...args],
        {
            encoding: 'utf8',
            timeout: 30000,
        },
    );
    if (result.status === 0) return result;
    try {
        result.stderr += readFileSync(
            join(root, 'results/logs/baseline.tap'),
            'utf8',
        );
    } catch {
        /* A configuration error can occur before baseline logging. */
    }
    return result;
}

async function report(root) {
    return JSON.parse(
        await readFile(join(root, 'results/report.json'), 'utf8'),
    );
}

async function assertRemoved(path) {
    await assert.rejects(stat(path), { code: 'ENOENT' });
}

test('mutation manifest covers runtime operators while excluding types and comments', () => {
    const source = `
        type Flag = true;
        // false && x > y
        export function value(a: number, b: number, enabled: boolean) {
            if (a < b && !enabled) return true;
            return a >= b || false;
        }
    `;
    const mutants = generateMutants(source, 'src/value.ts');
    assert.deepEqual(
        new Set(mutants.map((mutant) => mutant.operator)),
        new Set([
            'boolean',
            'logical',
            'comparison-negation',
            'comparison-boundary',
            'guard-true',
            'guard-false',
            'negation-removal',
        ]),
    );
    assert.ok(mutants.every((mutant) => mutant.line >= 5));
    assert.ok(
        mutants.every(
            (mutant) =>
                source.slice(mutant.start, mutant.end) === mutant.original,
        ),
    );
    assert.equal(
        new Set(mutants.map((mutant) => mutant.hash)).size,
        mutants.length,
    );
    assert.deepEqual(generateMutants(source, 'src/value.ts'), mutants);
});

test('public runner kills assertions, reports survivors, logs TAP and restores isolated sources', async (t) => {
    const source =
        'export const value = true;\nexport function unused(flag) { if (flag) return 1; return 2; }\n';
    const root = await fixture(
        t,
        source,
        "test('value', () => assert.equal(value, true));",
    );
    const listed = run(root, '--list');
    assert.equal(listed.status, 0, listed.stderr);
    await assertRemoved(join(root, 'results/report.json'));
    const manifest = JSON.parse(
        await readFile(join(root, 'results/manifest.json'), 'utf8'),
    );
    assert.equal(manifest.mutants.length, 3);
    assert.match(manifest.testHashes['test/value.test.mjs'], /^[a-f0-9]{64}$/);
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    const actual = await report(root);
    assert.equal(actual.complete, true);
    assert.deepEqual(actual.summary.counts, { killed: 1, survived: 2 });
    assert.equal(actual.results.length, manifest.mutants.length);
    assert.equal(actual.baseline.tap.tests, 1);
    const killed = actual.results.find((mutant) => mutant.status === 'killed');
    assert.match(await readFile(killed.log, 'utf8'), /ERR_ASSERTION/);
    assert.equal(await readFile(join(root, 'src/value.mjs'), 'utf8'), source);
    await assertRemoved(actual.workspace);
    const survivor = actual.results.find(
        (mutant) => mutant.status === 'survived',
    );
    const rerun = run(root, '--only-ids', survivor.id);
    assert.equal(rerun.status, 0, rerun.stderr);
    const repeated = await report(root);
    assert.deepEqual(repeated.selectedIds, [survivor.id]);
    assert.equal(repeated.mutants.length, manifest.mutants.length);
    assert.equal(repeated.results.length, 1);
});

test('baseline assertion failure stops before mutations and cleans the workspace', async (t) => {
    const source = 'export const value = true;\n';
    const root = await fixture(
        t,
        source,
        "test('baseline', () => assert.equal(value, false));",
    );
    const result = run(root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Baseline failed/);
    const actual = await report(root);
    assert.equal(actual.complete, false);
    assert.equal(actual.baseline.status, 'killed');
    assert.equal(actual.results.length, 0);
    assert.equal(await readFile(join(root, 'src/value.mjs'), 'utf8'), source);
    await assertRemoved(actual.workspace);
});

test('runtime module setup failure is excluded from the mutation score', async (t) => {
    const source =
        "export async function value(flag = true) { if (flag) return true; return (await import('./missing.mjs')).value; }\n";
    const root = await fixture(
        t,
        source,
        "test('value', async () => assert.equal(await value(), true));",
    );
    const mutant = generateMutants(source, 'src/value.mjs').find(
        (item) => item.operator === 'guard-false',
    );
    const result = run(root, '--only-ids', mutant.id);
    assert.equal(result.status, 2);
    const actual = await report(root);
    assert.equal(actual.results[0].status, 'invalid');
    assert.equal(actual.summary.scored, 0);
    assert.equal(actual.summary.mutationScore, null);
    assert.match(
        await readFile(actual.results[0].log, 'utf8'),
        /ERR_MODULE_NOT_FOUND/,
    );
    await assertRemoved(actual.workspace);
});

async function assertProcessExited(pid) {
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            process.kill(pid, 0);
        } catch (error) {
            assert.equal(error.code, 'ESRCH');
            return;
        }
        await delay(50);
    }
    assert.fail(`Process ${pid} survived mutation timeout`);
}

test('hanging mutant kills its test process and descendants, restores source and cannot count as killed', async (t) => {
    const source =
        'export function value() { while (false) {} return true; }\n';
    const root = await fixture(t, source, '');
    const pidPath = join(root, 'child-pids.json');
    await writeFile(
        join(root, 'test/value.test.mjs'),
        `
        import assert from 'node:assert/strict';
        import { test } from 'node:test';
        import { spawn } from 'node:child_process';
        import { writeFileSync } from 'node:fs';
        import { value } from '../src/value.mjs';
        test('value', () => {
            const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
            child.unref();
            writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify([process.pid, child.pid]));
            assert.equal(value(), true);
        });
    `,
    );
    const mutant = generateMutants(source, 'src/value.mjs').find(
        (item) => item.operator === 'guard-true',
    );
    const result = run(root, '--only-ids', mutant.id);
    assert.equal(result.status, 2);
    const actual = await report(root);
    assert.equal(actual.results[0].status, 'timeout');
    assert.equal(actual.summary.scored, 0);
    assert.equal(await readFile(join(root, 'src/value.mjs'), 'utf8'), source);
    await assertRemoved(actual.workspace);
    const pids = JSON.parse(await readFile(pidPath, 'utf8'));
    assert.equal(pids.length, 2);
    for (const pid of pids) await assertProcessExited(pid);
});

test('production exceptions inside named tests kill mutants', async (t) => {
    const source =
        "export function value() { if (true) return 1; throw new Error('unreachable production failure'); }\n";
    const root = await fixture(
        t,
        source,
        "test('value', () => assert.equal(value(), 1));",
    );
    const mutant = generateMutants(source, 'src/value.mjs').find(
        (item) => item.replacement === 'false',
    );
    const result = run(root, '--only-ids', mutant.id);
    assert.equal(result.status, 0, result.stderr);
    const actual = await report(root);
    assert.equal(actual.results[0].status, 'killed');
    assert.match(
        await readFile(actual.results[0].log, 'utf8'),
        /ERR_TEST_FAILURE/,
    );
});

test('file-level runtime setup errors fail closed before mutation', async (t) => {
    const root = await fixture(
        t,
        'export const value = true;',
        "throw new Error('setup unavailable');",
    );
    const result = run(root);
    assert.equal(result.status, 2);
    const actual = await report(root);
    assert.equal(actual.baseline.status, 'infrastructure-error');
    assert.equal(actual.results.length, 0);
    await assertRemoved(actual.workspace);
});

test('runtime SyntaxError inside a test kills mutants while passing diagnostic words remain harmless', async (t) => {
    const source =
        'export function value() { if (true) return 1; return JSON.parse("invalid"); }\n';
    const root = await fixture(
        t,
        source,
        "test('SyntaxError handling', () => { console.log('SyntaxError TransformError Cannot find module'); assert.equal(value(), 1); });",
    );
    const mutant = generateMutants(source, 'src/value.mjs').find(
        (item) => item.replacement === 'false',
    );
    const result = run(root, '--only-ids', mutant.id);
    assert.equal(result.status, 0, result.stderr);
    const actual = await report(root);
    assert.equal(actual.baseline.status, 'survived');
    assert.equal(actual.results[0].status, 'killed');
    assert.match(await readFile(actual.results[0].log, 'utf8'), /SyntaxError/);
});

test('assertion values containing exitCode or loader codes remain actual test kills', async (t) => {
    const root = await fixture(
        t,
        'export const value = true;',
        "test('object diagnostics', () => assert.deepEqual({ exitCode: value ? 0 : 1, code: value ? 'OK' : 'ERR_MODULE_NOT_FOUND' }, { exitCode: 0, code: 'OK' }));",
    );
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    const actual = await report(root);
    assert.equal(actual.results[0].status, 'killed');
    assert.equal(actual.summary.scored, 1);
});

test('operator edits produce the exact source variants despite parentheses and commented operator text', () => {
    const source =
        'export function value(a, b) { if (a) return !(a /* && < */ < b) && true; return a >= b; }';
    const expected = [
        'export function value(a, b) { if (false) return !(a /* && < */ < b) && true; return a >= b; }',
        'export function value(a, b) { if (true) return !(a /* && < */ < b) && true; return a >= b; }',
        'export function value(a, b) { if (a) return (a /* && < */ < b) && true; return a >= b; }',
        'export function value(a, b) { if (a) return !(a /* && < */ >= b) && true; return a >= b; }',
        'export function value(a, b) { if (a) return !(a /* && < */ <= b) && true; return a >= b; }',
        'export function value(a, b) { if (a) return !(a /* && < */ < b) || true; return a >= b; }',
        'export function value(a, b) { if (a) return !(a /* && < */ < b) && false; return a >= b; }',
        'export function value(a, b) { if (a) return !(a /* && < */ < b) && true; return a < b; }',
        'export function value(a, b) { if (a) return !(a /* && < */ < b) && true; return a > b; }',
    ];
    const actual = generateMutants(source, 'src/value.mjs').map((mutant) =>
        applyMutant(source, mutant),
    );
    assert.deepEqual(actual.sort(), expected.sort());
});
