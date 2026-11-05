import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import App from '../src/tui/app.js';
import { daemonFixture, eventually } from './daemon-fixture.js';
import { terminal } from './support/terminal.js';

async function appTerminal(
    columns: number,
    rows: number,
    cleanup: (callback: () => void | Promise<void>) => void,
) {
    const fixture = await daemonFixture();
    const client = await fixture.client();
    const view = terminal(createElement(App, { client }), {
        columns,
        rows,
    });
    cleanup(async () => {
        view.app.unmount();
        client.close();
        await fixture.close();
    });
    await eventually(() => view.frame().includes('Services'));
    return view;
}

test('Escape is safe at root and help replaces the workspace footer', async (t) => {
    const view = await appTerminal(80, 24, (cleanup) => t.after(cleanup));
    await view.key('\u001b');
    assert.match(view.frame(), /Services/);
    assert.match(view.frame(), /q quit/);
    assert.equal(view.frame().includes('Keyboard shortcuts'), false);

    await view.key('?');
    assert.match(view.frame(), /Keyboard shortcuts/);
    assert.match(view.frame(), /Ctrl\+N\/P/);
    assert.equal(view.frame().includes('SERVICE'), false);
    await view.key('\u001b');
    assert.match(view.frame(), /SERVICE/);
});

test('root frames stay within both supported preview sizes', async (t) => {
    for (const [columns, rows] of [
        [80, 24],
        [120, 34],
    ]) {
        const view = await appTerminal(columns, rows, (cleanup) =>
            t.after(cleanup),
        );
        const lines = view.frame().split('\n');
        assert.ok(lines.every((line) => line.length <= columns));
        assert.ok(lines.length <= rows + 1);
    }
});

test('service search keeps its query until Escape clears it', async (t) => {
    const view = await appTerminal(80, 24, (cleanup) => t.after(cleanup));
    await view.key('/');
    await view.key('api');
    await view.key('\r');
    assert.match(view.frame(), /Filter: api/);
    await view.key('\u001b');
    assert.match(view.frame(), /\/ to filter/);
    assert.doesNotMatch(view.frame(), /Filter: api/);
});

test('search text owns q and question mark', async (t) => {
    const view = await appTerminal(80, 24, (cleanup) => t.after(cleanup));
    await view.key('/');
    await view.key('?q');
    assert.match(view.frame(), /\/\?q/);
    assert.doesNotMatch(view.frame(), /Keyboard shortcuts/);
});
