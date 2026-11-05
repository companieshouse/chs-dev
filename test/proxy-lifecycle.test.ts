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

test('a failed idle unload retains activity so the next sweep retries', async () => {
    let attempts = 0;
    const lifecycle = createLazyLifecycle({
        isLazy: () => true,
        start: async () => {},
        stop: async () => {
            attempts++;
            if (attempts === 1) throw new Error('engine busy');
        },
    });
    lifecycle.seen('api');
    const idle = Date.now() + IDLE_UNLOAD_MS + 1;
    assert.deepEqual(await lifecycle.sweep(idle), []);
    assert.deepEqual(await lifecycle.sweep(idle + 1), ['api']);
    assert.equal(attempts, 2);
});

test('reset discards old activity and late start completion cannot replace a new checkout start', async () => {
    const releases: (() => void)[] = [];
    const lifecycle = createLazyLifecycle({
        isLazy: () => true,
        start: () =>
            new Promise<void>((resolve) => {
                releases.push(resolve);
            }),
        stop: async () => {
            throw new Error('Old activity must not unload the new checkout');
        },
    });
    const oldStart = lifecycle.start('api');
    await Promise.resolve();
    lifecycle.reset();
    const newStart = lifecycle.start('api');
    await Promise.resolve();
    releases[0]!();
    await oldStart;
    assert.deepEqual(lifecycle.coldStarting(), ['api']);
    releases[1]!();
    await newStart;
    lifecycle.reset();
    assert.deepEqual(
        await lifecycle.sweep(Date.now() + IDLE_UNLOAD_MS + 1),
        [],
    );
});

test('an idle stop completing after reset cannot clear new checkout activity', async () => {
    let release!: () => void;
    let stops = 0;
    const lifecycle = createLazyLifecycle({
        isLazy: () => true,
        start: async () => {},
        stop: async () => {
            stops++;
            if (stops === 1)
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
        },
    });
    lifecycle.seen('api');
    const sweeping = lifecycle.sweep(Date.now() + IDLE_UNLOAD_MS + 1);
    lifecycle.reset();
    lifecycle.seen('api');
    release();
    assert.deepEqual(await sweeping, []);
    assert.deepEqual(await lifecycle.sweep(Date.now() + IDLE_UNLOAD_MS + 1), [
        'api',
    ]);
    assert.equal(stops, 2);
});

test('idle unload cannot erase newer request activity recorded in the same millisecond', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    let releaseStop!: () => void;
    let stops = 0;
    const lifecycle = createLazyLifecycle({
        isLazy: () => true,
        start: async () => {},
        stop: async () => {
            stops++;
            if (stops === 1)
                await new Promise<void>((resolve) => {
                    releaseStop = resolve;
                });
        },
    });
    lifecycle.seen('api');
    const stopping = lifecycle.stop('api');
    const releaseRequest = lifecycle.request('api');
    releaseRequest();
    releaseStop();
    await stopping;
    assert.deepEqual(await lifecycle.sweep(1000 + IDLE_UNLOAD_MS + 1), ['api']);
    assert.equal(stops, 2);
});
