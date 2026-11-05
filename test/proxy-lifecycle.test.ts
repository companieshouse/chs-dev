import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createLazyLifecycle,
    IDLE_UNLOAD_MS,
    lazyChain,
} from '../src/proxy/lifecycle.js';

function harness() {
    const events: string[] = [];
    const logged: Array<Parameters<ProxyLog>> = [];
    const lifecycle = createLazyLifecycle({
        isLazy: (service) => service === 'felixvalidator',
        start: async (service) => {
            events.push(`start ${service}`);
        },
        stop: async (service) => {
            events.push(`stop ${service}`);
        },
        log: (message, event) => {
            events.push(`log ${message}`);
            logged.push([message, event]);
        },
    });
    return { lifecycle, events, logged };
}

test('a cold-start chain orders dependencies before the called service', () => {
    const dependencies = new Map([
        ['a', ['b', 'shared']],
        ['b', ['c']],
        ['c', []],
        ['shared', ['c']],
    ]);
    assert.deepEqual(lazyChain('a', dependencies), ['c', 'b', 'shared', 'a']);
    assert.deepEqual(lazyChain('missing', dependencies), ['missing']);
    const cyclic = new Map([
        ['x', ['y']],
        ['y', ['x']],
    ]);
    assert.deepEqual(lazyChain('x', cyclic), ['y', 'x']);
});

test('concurrent cold starts share one start call and seed the idle timer', async () => {
    const { lifecycle, events } = harness();
    await Promise.all([
        lifecycle.start('felixvalidator'),
        lifecycle.start('felixvalidator'),
        lifecycle.start('felixvalidator'),
    ]);
    assert.deepEqual(events, ['start felixvalidator']);
    const unloaded = await lifecycle.sweep(Date.now());
    assert.deepEqual(unloaded, []);
});

test('an idle lazy service unloads after the window and logs it', async () => {
    const { lifecycle, events } = harness();
    await lifecycle.start('felixvalidator');
    const stoppedAt = Date.now();
    const unloaded = await lifecycle.sweep(stoppedAt + IDLE_UNLOAD_MS + 1);
    assert.deepEqual(unloaded, ['felixvalidator']);
    assert.ok(events.includes('stop felixvalidator'));
    assert.ok(
        events.some((event) => event.startsWith('log unloaded idle service')),
    );
});

test('touch refreshes the idle window; a request during it prevents unload', async () => {
    const { lifecycle, events } = harness();
    lifecycle.seen('felixvalidator');
    await lifecycle.sweep(IDLE_UNLOAD_MS - 1000);
    lifecycle.touch('felixvalidator');
    const unloaded = await lifecycle.sweep(2 * IDLE_UNLOAD_MS);
    assert.deepEqual(unloaded, []);
    assert.deepEqual(events, []);
});

test('unloads are logged with cause, service, and status fields', async () => {
    const { lifecycle, logged } = harness();
    await lifecycle.start('felixvalidator');
    await lifecycle.sweep(Date.now() + IDLE_UNLOAD_MS + 1);
    assert.deepEqual(logged, [
        [
            'unloaded idle service felixvalidator',
            {
                service: 'felixvalidator',
                cause: 'idle-unload',
                status: 'success',
            },
        ],
    ]);
});

test('always-start services are never unloaded', async () => {
    const { lifecycle, events } = harness();
    lifecycle.seen('accounts-filing-web');
    const unloaded = await lifecycle.sweep(Date.now() + 10 * IDLE_UNLOAD_MS);
    assert.deepEqual(unloaded, []);
    assert.deepEqual(events, []);
});

test('stop clears the activity entry so a restart re-seeds', async () => {
    const { lifecycle, events } = harness();
    await lifecycle.start('felixvalidator');
    await lifecycle.stop('felixvalidator');
    const unloaded = await lifecycle.sweep(Date.now() + IDLE_UNLOAD_MS + 1);
    assert.deepEqual(unloaded, []);
    assert.deepEqual(events, ['start felixvalidator', 'stop felixvalidator']);
});
