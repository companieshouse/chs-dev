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
    assert.match(view.frame(), /i\s+details/);
    assert.match(view.frame(), /PgUp PgDn\s+page/);
    assert.equal(view.frame().includes('SERVICE'), false);
    await view.key('\u001b');
    assert.match(view.frame(), /SERVICE/);
});

test('root frames stay within both supported preview sizes', async (t) => {
    for (const [columns, rows] of [
        [80, 24],
        [120, 34],
        [160, 45],
    ]) {
        const view = await appTerminal(columns, rows, (cleanup) =>
            t.after(cleanup),
        );
        const lines = view.frame().split('\n');
        assert.match(
            lines[0]!,
            /Services.*Containers.*Modules.*Enabled.*Journeys.*Logs.*Config/,
        );
        assert.equal(
            lines.filter((line) => /╭.*Services/.test(line)).length,
            0,
        );
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

test('Services distinguishes saved provider edits from applied mode and observed runtime', async (t) => {
    const fixture = await daemonFixture();
    const client = await fixture.client();
    const view = terminal(createElement(App, { client }), {
        columns: 80,
        rows: 24,
    });
    t.after(async () => {
        view.app.unmount();
        await fixture.close();
    });
    await client.command('environment.start', {});
    await eventually(() => client.getSnapshot().live.running);
    await client.command('configuration.save', {
        revision: client.getSnapshot().configurationRevision,
        edit: { name: 'api', enabled: true, development: true, exclusions: {} },
    });
    await eventually(() => view.frame().includes('Saved: Yes Development'));
    assert.match(view.frame(), /Pending: saved changes/);
    assert.match(view.frame(), /Inactive Service version: —/);
    assert.match(view.frame(), /Inactive Service source: compose/);
    assert.match(view.frame(), /Applied mode \(observed\): Service/);
    assert.match(view.frame(), /RUNTIME/);
    assert.match(view.frame(), /Running/);
    await client.command('environment.apply', {});
    await eventually(() =>
        view.frame().includes('Applied mode (observed): Development'),
    );
    assert.match(view.frame(), /Pending: none/);
    await client.command('service.action', {
        services: ['api'],
        action: 'stop',
    });
    await client.query('refresh', {});
    await eventually(() => view.frame().includes('Runtime: Stopped'));
    await eventually(() => view.frame().includes('Intent: manual stop'));
    assert.match(view.frame(), /traffic will not start this service/);
    await view.key('\r');
    assert.match(view.frame(), /Provider: development/);
    await view.key('\u001b');
    await view.key('\u0005');
    assert.match(view.frame(), /Re-apply configuration|Apply changes/);
});

test('an idle service can be held stopped through the TUI and released by explicit Start', async (t) => {
    const fixture = await daemonFixture();
    const client = await fixture.client();
    await client.command('environment.start', {});
    fixture.stores.get(fixture.directory)!.containers[0].policy!.lazy = true;
    assert.equal((await fixture.controller.idleUnload('api')).ok, true);
    await client.query('refresh', {});
    assert.deepEqual(client.getSnapshot().live.stoppedByUser, []);
    const view = terminal(createElement(App, { client }), {
        columns: 80,
        rows: 24,
    });
    t.after(async () => {
        view.app.unmount();
        await fixture.close();
    });
    await view.waitFor(/Runtime: Stopped/);
    await view.key('\r');
    for (
        let steps = 0;
        steps < 18 && !/› Stop service/.test(view.frame());
        steps++
    )
        await view.key('\u001b[B');
    assert.match(view.frame(), /› Stop service/);
    await view.key('\r');
    assert.match(
        view.frame().replace(/│/g, '').replace(/\s+/g, ' '),
        /Traffic and ordinary Apply will keep it stopped/,
    );
    await view.key('y');
    await eventually(() =>
        client.getSnapshot().live.stoppedByUser.includes('api'),
    );
    assert.equal(
        (await fixture.controller.coldStart('api', Date.now() + 1000)).ok,
        false,
    );
    await view.waitFor(/Kept api stopped/);
    await view.key('\u001b');
    await view.waitFor(/Intent: manual stop/);
    await client.command('service.action', {
        services: ['api'],
        action: 'start',
    });
    await client.query('refresh', {});
    await view.waitFor(/Runtime: Running/);
    assert.deepEqual(client.getSnapshot().live.stoppedByUser, []);
    assert.doesNotMatch(view.frame(), /Intent: manual stop/);
});

test('the TUI can confirm Environment Stop while Start is still running', async (t) => {
    const fixture = await daemonFixture();
    const client = await fixture.client();
    let release!: () => void;
    fixture.engine.applyGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const view = terminal(createElement(App, { client }), {
        columns: 80,
        rows: 24,
    });
    t.after(async () => {
        release();
        view.app.unmount();
        await fixture.close();
    });
    const start = await client.submit('environment.start', {});
    await eventually(() => fixture.engine.applies === 1);
    await view.key('\u0005');
    assert.match(view.frame(), /Cancel/);
    assert.match(view.frame(), /Stop environment/);
    const lines = view.frame().split('\n');
    assert.ok(lines.length <= 25);
    assert.ok(lines.every((line) => line.length <= 80));
    for (
        let steps = 0;
        steps < 6 && !/› Stop environment/.test(view.frame());
        steps++
    )
        await view.key('\u001b[B');
    assert.match(view.frame(), /› Stop environment/);
    await view.key('\r');
    assert.match(view.frame(), /Stop all services in this environment/);
    assert.equal(fixture.engine.stops, 0, 'Stop requires confirmation');
    await view.key('y');
    await eventually(() => client.getSnapshot().live.phase === 'Stopped');
    await assert.rejects(
        client.wait(start.id),
        /superseded by Environment Stop/,
    );
    assert.equal(client.getSnapshot().live.running, false);
    assert.equal(client.getSnapshot().live.busy, false);
    assert.equal(fixture.engine.stops, 1);
    assert.equal(fixture.stores.get(fixture.directory)!.containers.length, 0);
});
