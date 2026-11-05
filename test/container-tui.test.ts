import { terminal } from './support/terminal.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import ContainersScreen from '../src/tui/components/containers-screen.js';
import ContainerDetails from '../src/tui/components/container-details.js';
import App from '../src/tui/app.js';
import { daemonFixture, eventually } from './daemon-fixture.js';
import type {
    ContainerDetails as Details,
    ContainerManager,
} from '../src/domain/containers.js';

const detail: Details = {
    id: 'a'.repeat(64),
    name: 'api',
    image: 'repo/api:1.2',
    imageId: 'sha256:example',
    state: 'running',
    status: 'Healthy',
    health: 'healthy',
    service: 'api',
    currentProject: true,
    ports: ['8080/tcp'],
    mounts: [],
    networks: [],
    inspection: { Id: 'a'.repeat(64), Config: { Env: ['PASSWORD=[hidden]'] } },
};
function fixture() {
    const calls: string[] = [];
    const manager: ContainerManager = {
        list: async () => [
            { ...detail },
            {
                ...detail,
                id: 'b'.repeat(64),
                name: 'unrelated',
                currentProject: false,
            },
        ],
        inspect: async (id) => {
            calls.push(`inspect:${id}`);
            return { ...detail };
        },
        logs: async (id) => {
            calls.push(`logs:${id}`);
            return ['hello from api'];
        },
        action: async () => ({ outcome: 'success', message: 'done' }),
    };
    return { manager, calls };
}
test('Containers tab switches scope, filters and opens the exact selected ID', async (t) => {
    const { manager } = fixture();
    const opened: string[] = [];
    const term = terminal(
        createElement(ContainersScreen, {
            manager,
            active: true,
            height: 25,
            onOpen: (id) => opened.push(id),
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    assert.match(term.output(), /This checkout/);
    assert.doesNotMatch(term.output(), /unrelated/);
    term.clear();
    await term.key('a');
    assert.match(term.output(), /All containers/);
    assert.match(term.output(), /unrelated/);
    await term.key('/');
    await term.key('unrelated');
    await term.key('\r');
    await term.key('\r');
    assert.deepEqual(opened, ['b'.repeat(64)]);
});

test('service link opens the matching container directly', async (t) => {
    const { manager } = fixture();
    const opened: string[] = [];
    const term = terminal(
        createElement(ContainersScreen, {
            manager,
            active: true,
            height: 25,
            request: { service: 'api', sequence: 1 },
            onOpen: (id) => opened.push(id),
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    assert.deepEqual(opened, [detail.id]);
});

test('container details show the image version, inspect data, logs and stop control', async (t) => {
    const { manager, calls } = fixture();
    const actions: string[] = [];
    const term = terminal(
        createElement(ContainerDetails, {
            manager,
            id: detail.id,
            environmentBusy: false,
            onClose: () => {},
            onAction: async (container, action) => {
                actions.push(`${action}:${container.id}`);
                return { ok: true, message: 'Stopped api.' };
            },
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    assert.match(term.output(), /Version\/tag: 1.2/);
    await term.key('i');
    assert.match(term.output(), /environment values and credentials hidden/);
    await term.key('l');
    assert.match(term.output(), /hello from api/);
    assert.ok(calls.includes(`logs:${detail.id}`));
    await term.key('\u001b');
    await term.key('s');
    assert.deepEqual(actions, [`stop:${detail.id}`]);
});

test('container action suspends inspection and refreshes exactly once on completion', async (t) => {
    const { manager, calls } = fixture();
    let release!: (value: { ok: boolean; message: string }) => void;
    const pending = new Promise<{ ok: boolean; message: string }>((resolve) => {
        release = resolve;
    });
    let actions = 0;
    const term = terminal(
        createElement(ContainerDetails, {
            manager,
            id: detail.id,
            environmentBusy: false,
            onClose: () => {},
            onAction: () => {
                actions++;
                return pending;
            },
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('s');
    await term.key('s');
    assert.equal(actions, 1);
    assert.equal(calls.filter((call) => call.startsWith('inspect:')).length, 1);
    release({ ok: true, message: 'Stopped.' });
    await delay(150);
    assert.equal(calls.filter((call) => call.startsWith('inspect:')).length, 2);
});

test('healthy periodic inspection keeps details visible without a refresh spinner', async (t) => {
    const { manager, calls } = fixture();
    let release!: (value: Details) => void;
    const pending = new Promise<Details>((resolve) => {
        release = resolve;
    });
    const initial = manager.inspect;
    manager.inspect = async (id, signal) => {
        if (calls.length) {
            calls.push(`inspect:${id}`);
            return pending;
        }
        return initial(id, signal);
    };
    const term = terminal(
        createElement(ContainerDetails, {
            manager,
            id: detail.id,
            environmentBusy: false,
            onClose: () => {},
            onAction: async () => ({ ok: true, message: '' }),
        }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    term.clear();
    await delay(5100);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(term.output(), /Refreshing/);
    release({ ...detail, image: 'repo/api:1.3' });
    await delay(150);
    assert.match(term.output(), /Version\/tag: 1.3/);
});

test('an old inspection response cannot replace a newly selected container', async (t) => {
    const { manager } = fixture();
    let release!: (value: Details) => void;
    const pending = new Promise<Details>((resolve) => {
        release = resolve;
    });
    const nextId = 'b'.repeat(64);
    manager.inspect = async (id) =>
        id === detail.id ? pending : { ...detail, id, name: 'new-container' };
    const props = {
        manager,
        environmentBusy: false,
        onClose: () => {},
        onAction: async () => ({ ok: true, message: '' }),
    };
    const term = terminal(
        createElement(ContainerDetails, { ...props, id: detail.id }),
    );
    t.after(() => term.app.unmount());
    await delay(150);
    term.rerender(createElement(ContainerDetails, { ...props, id: nextId }));
    await delay(150);
    term.clear();
    release({ ...detail, name: 'stale-container' });
    await term.key('i');
    assert.match(term.output(), /new-container/);
    assert.doesNotMatch(term.output(), /stale-container/);
});

test('container details fill a wide window and reserve rows for notices and the footer', async (t) => {
    const { manager } = fixture();
    const image = `registry.example/${'a'.repeat(112)}:1.2`;
    manager.inspect = async () => ({ ...detail, image });
    const term = terminal(
        createElement(ContainerDetails, {
            manager,
            id: detail.id,
            environmentBusy: true,
            onClose: () => {},
            onAction: async () => ({ ok: true, message: '' }),
        }),
        { columns: 160, rows: 28 },
    );
    t.after(() => term.app.unmount());
    await eventually(() => term.frame().includes(image));
    const frame = term.frame().split('\n');
    assert.equal(frame.length, 28);
    assert.match(frame[0], /← Back \(Esc\).*Containers/);
    assert.ok(frame.some((line) => line.includes(`Image: ${image}`)));
    assert.match(frame.at(-1)!, /Esc back/);
    assert.doesNotMatch(term.frame(), /[╭╮╰╯]/);
    term.resize(42, 12);
    await delay(100);
    assert.equal(term.frame().split('\n').length, 12);
    assert.match(term.frame().split('\n')[0], /← Back \(Esc\).*Containers/);
    assert.match(term.frame().split('\n').at(-1)!, /Esc back/);
    assert.ok(
        term
            .frame()
            .split('\n')
            .every((line) => line.length <= 42),
    );
});

test('container details and logs replace the workspace and return to the filtered list', async (t) => {
    const f = await daemonFixture();
    t.after(() => f.close());
    const client = await f.client();
    const query = client.query.bind(client);
    client.query = (async (name, ...args) => {
        if (name === 'containers.list') return [{ ...detail }];
        if (name === 'containers.inspect') return { ...detail };
        if (name === 'containers.logs') return ['CONTAINER_LOG_OUTPUT'];
        return query(name, ...args);
    }) as typeof client.query;
    const term = terminal(createElement(App, { client }), {
        columns: 160,
        rows: 28,
    });
    t.after(() => term.app.unmount());
    await delay(150);
    await term.key('\t');
    await eventually(() => term.frame().includes('This checkout'));
    await term.key('/');
    await term.key('api');
    await term.key('\r');
    const browser = term.frame();
    await term.key('\r');
    await eventually(() => term.frame().includes('Name: api'));
    assert.match(
        term.frame().split('\n')[0],
        /← Back \(Esc\).*Containers \/ Details/,
    );
    assert.doesNotMatch(term.frame(), /This checkout|Enter details|profile:/);
    assert.equal(term.frame().split('\n').length, 28);
    await term.key('l');
    await eventually(() => term.frame().includes('CONTAINER_LOG_OUTPUT'));
    assert.match(
        term.frame().split('\n')[0],
        /← Back \(Esc\).*Containers \/ Logs/,
    );
    assert.doesNotMatch(
        term.frame(),
        /Name: api|This checkout|Enter details|profile:|[╭╮╰╯]/,
    );
    assert.equal(term.frame().split('\n').length, 28);
    await term.key('\t');
    assert.match(term.frame(), /api logs/);
    await term.key('\u001b');
    assert.match(term.frame(), /Name: api/);
    assert.match(
        term.frame().split('\n')[0],
        /← Back \(Esc\).*Containers \/ Details/,
    );
    await term.key('\u001b');
    await eventually(() => term.frame().includes('This checkout'));
    assert.equal(term.frame(), browser);
});
