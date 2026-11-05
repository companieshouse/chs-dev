import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const rule = 'local/combined-nesting';
const eslint = new ESLint({
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    allowInlineConfig: false,
});
async function findings(source, filePath = 'src/probe.ts') {
    const [result] = await eslint.lintText(source, { filePath });
    assert.equal(result.fatalErrorCount, 0);
    return result.messages.filter((message) => message.ruleId === rule);
}

test('combined nesting catches mixed callback and control flow that separate limits accept', async () => {
    const [result] = await eslint.lintText(
        `
        export function stream(items) {
            listen(() => {
                while (items.length) {
                    listen(() => {
                        if (items.pop()) consume();
                    });
                }
            });
        }`,
        { filePath: 'src/probe.ts' },
    );
    assert.deepEqual(
        result.messages.map((message) => message.ruleId),
        [rule],
    );
    assert.match(result.messages[0].message, /depth is 4.*allowed is 3/);
});

test('exact combined boundary is accepted and only the first excess on a path is reported', async () => {
    assert.deepEqual(
        await findings(
            'export function run() { listen(() => { while (ready()) { if (ok()) work(); } }); }',
        ),
        [],
    );
    const source =
        'export function run() { listen(() => { while (ready()) { if (ok()) { try { if (ready()) work(); } finally { clean(); } } } }); }';
    const messages = await findings(source);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].messageId, 'tooDeep');
    assert.equal(messages[0].column, source.indexOf('try') + 1);
    assert.match(messages[0].message, /depth is 4/);
});

test('nested callbacks use the same counter and the configured limit is honoured', async () => {
    const source =
        'export function run() { listen(() => listen(() => listen(() => listen(() => work())))); }';
    assert.equal((await findings(source)).length, 1);
    const stricter = new ESLint({
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        overrideConfig: { rules: { [rule]: ['warn', 2] } },
    });
    const [result] = await stricter.lintText(
        'export function run() { listen(() => { while (ready()) { if (ok()) work(); } }); }',
        { filePath: 'src/probe.ts' },
    );
    assert.deepEqual(
        result.messages.map((message) => message.ruleId),
        [rule],
    );
    assert.match(result.messages[0].message, /depth is 3.*allowed is 2/);
});

test('nested named functions retain enclosing control flow and extracted helpers start independently', async () => {
    assert.equal(
        (
            await findings(
                'export function run() { if (ok()) { while (ready()) { function local() { if (ok()) work(); } local(); } } }',
            )
        ).length,
        1,
    );
    assert.deepEqual(
        await findings(
            'function process() { if (ok()) work(); } export function run() { if (ok()) { while (ready()) { process(); } } }',
        ),
        [],
    );
});

test('else-if chains, catch and finally do not add artificial levels', async () => {
    assert.deepEqual(
        await findings(
            'export function run() { listen(() => { try { if (a()) work(); else if (b()) work(); else work(); } catch { if (a()) recover(); } finally { if (a()) clean(); } }); }',
        ),
        [],
    );
});

test('counts are balanced across siblings, loops, switches, methods and static blocks', async () => {
    assert.deepEqual(
        await findings(
            'export function run() { listen(() => { for (const value of values) { if (value) work(); } for (const key in values) { if (key) work(); } do { if (ok()) work(); } while (ok()); switch (value) { case 1: if (ok()) work(); } }); }',
        ),
        [],
    );
    assert.equal(
        (
            await findings(
                'class Worker { run() { listen(() => { while (ready()) { if (ok()) { work(() => done()); } } }); } }',
            )
        ).length,
        1,
    );
    assert.deepEqual(
        await findings(
            'class Worker { static { listen(() => { while (ready()) { if (ok()) work(); } }); } }',
        ),
        [],
    );
});

test('JSX layout, wrapped expressions and TypeScript types do not contribute nesting', async () => {
    assert.deepEqual(
        await findings(
            `interface Handler { run(value: string): void }
        export function View() { return <A><B><C><D>{items.map((item) => <E value={item ? wrap({ key: [item] }) : undefined} />)}</D></C></B></A>; }`,
            'src/probe.tsx',
        ),
        [],
    );
});

test('inline suppression cannot bypass the combined audit', async () => {
    const messages = await findings(
        'export function run() { listen(() => { while (ready()) { if (ok()) {\n// eslint-disable-next-line local/combined-nesting\ntry { work(); } finally { clean(); } } } }); }',
    );
    assert.equal(messages.length, 1);
});
