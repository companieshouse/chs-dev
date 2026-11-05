import assert from 'node:assert/strict';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import { render } from 'ink';
import type { Client, ClientSnapshot } from '../../src/client/client.js';
import App from '../../src/tui/app.js';
import { daemonFixture } from '../daemon-fixture.js';

async function session(): Promise<ClientSnapshot> {
    const fixture = await daemonFixture();
    const snapshot = fixture.app.snapshot();
    await fixture.close();
    const services = Array.from({ length: 300 }, (_, i) => `service-${i}`);
    snapshot.groups = [
        {
            name: 'fixture',
            services,
            definitions: Object.fromEntries(
                services.map((name) => [
                    name,
                    {
                        module: 'fixture',
                        dependencies: [],
                        base: false,
                        deprecated: false,
                        development: true,
                    },
                ]),
            ),
        },
    ];
    snapshot.details = Object.fromEntries(
        services.map((name) => [name, { enabled: 'Yes', mode: 'Service' }]),
    );
    snapshot.statuses = Object.fromEntries(
        services.map((name) => [name, 'Running']),
    );
    snapshot.settings.resolved.autoLogin.value = 'off';
    snapshot.live = { ...snapshot.live, running: true, phase: 'Running' };
    return { ...snapshot, connection: 'connected' };
}

function memory() {
    global.gc!();
    return {
        heap: process.memoryUsage().heapUsed,
        measures: performance.getEntriesByType('measure').length,
    };
}

const source = JSON.stringify(await session());
let state: ClientSnapshot = JSON.parse(source);
const listeners = new Set<() => void>();
const client = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    query: async (name: string) => {
        assert.equal(name, 'containers.list');
        return [];
    },
    command: async (name: string) => {
        throw new Error(`Unexpected command: ${name}`);
    },
} as unknown as Client;
const stdout = Object.assign(
    new Writable({
        write(_chunk, _encoding, next) {
            next();
        },
    }),
    { isTTY: true, columns: 180, rows: 50 },
);
const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {},
    ref() {},
    unref() {},
});
let observedMeasures = 0;
const observer = new PerformanceObserver((entries) => {
    observedMeasures += entries.getEntries().length;
});
observer.observe({ entryTypes: ['measure'] });
const app = render(createElement(App, { client }), {
    stdout: stdout as any,
    stdin: stdin as any,
    stderr: stdout as any,
    interactive: true,
    patchConsole: false,
    exitOnCtrlC: false,
});

async function updates(count: number) {
    for (let i = 0; i < count; i++) {
        // Each daemon event parses a fresh snapshot, even when services are unchanged.
        state = JSON.parse(source);
        state.live.message = `Environment update ${i}`;
        for (const listener of listeners) listener();
        await delay(1);
    }
}

try {
    await updates(50);
    const before = memory();
    const subscriptions = listeners.size;
    await updates(150);
    const after = memory();
    assert.ok(subscriptions > 0);
    assert.equal(listeners.size, subscriptions);
    process.stdout.write(
        JSON.stringify({ before, after, observedMeasures }) + '\n',
    );
} finally {
    app.unmount();
    await app.waitUntilExit();
    observer.disconnect();
}
