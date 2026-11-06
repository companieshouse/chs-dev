import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonState } from '../src/infrastructure/daemon-state.js';
import { daemonFixture, eventually } from './daemon-fixture.js';

for (const kind of ['environment.start', 'environment.apply'] as const) {
    for (const outcome of ['failed', 'cancelled'] as const) {
        test(`latest ${outcome} ${kind} pauses an older clean checkpoint when later intent writes were lost`, async (t) => {
            let mutations = 0;
            const f = await daemonFixture(undefined, undefined, {
                runtime: (base) => ({
                    ...base,
                    startApplied: async (...args) => {
                        mutations++;
                        return base.startApplied(...args);
                    },
                }),
            });
            t.after(() => f.close());
            await (await f.client()).command('environment.start', {});
            await f.operations.close();
            const state = new DaemonState(join(f.root, 'state'));
            const [start] = await state.read();
            await state.write([
                {
                    ...start,
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:03.000Z',
                },
                {
                    ...start,
                    id: 'latest',
                    requestId: 'latest',
                    kind,
                    state: outcome,
                    createdAt: '2026-01-01T00:00:01.000Z',
                    updatedAt: '2026-01-01T00:00:02.000Z',
                },
            ]);
            f.stores.get(f.directory)!.containers[0].lifecycle = 'exited';
            await f.restart();
            await eventually(
                () =>
                    !f.app.snapshot().live.busy &&
                    (f.app.snapshot().live.running ||
                        f.controller.getIntent().paused),
            );
            assert.equal(mutations, 0);
            assert.equal(f.controller.getIntent().paused, true);
        });
    }
}

test('an unconfirmed Start establishes no authority even after operation history is trimmed', async (t) => {
    const stopped: string[] = [];
    const f = await daemonFixture(undefined, undefined, {
        runtime: (base) => ({
            ...base,
            stop: async (containers, context) => {
                stopped.push(
                    ...containers.map((container) => container.service),
                );
                return base.stop(containers, context);
            },
        }),
    });
    t.after(() => f.close());
    const store = f.stores.get(f.directory)!;
    store.containers = ['api', 'obsolete'].map((service) => ({
        id: service,
        service,
        mode: 'Service',
        projectName: 'fixture',
        projectDirectory: f.directory,
        lifecycle: 'running',
        policy: {
            version: 1,
            lazy: false,
            reclaimable: false,
            dependencies: [],
        },
    }));
    await assert.rejects(
        (await f.client()).command('environment.start', {}),
        (error: any) => error.detail?.code === 'CONFIRMATION_REQUIRED',
    );
    assert.deepEqual(f.app.snapshot().live.plan?.stop, ['obsolete']);
    const state = new DaemonState(join(f.root, 'state'));
    assert.equal((await state.readIntent())?.intent, undefined);
    await f.operations.close();
    await state.write([]);
    await f.restart();
    await f.controller.poll();
    assert.deepEqual(stopped, []);
    assert.equal(
        store.containers.every(
            (container) => container.lifecycle === 'running',
        ),
        true,
    );
    assert.equal(f.engine.applies, 0);
});

test('checkout switching supersedes pending recovery and persists stopped switching intent before cleanup', async (t) => {
    let available = true;
    const f = await daemonFixture(undefined, undefined, {
        configure: (backend) => {
            backend.runtime.engineIdentity = async () => {
                if (!available) throw new Error('identity unavailable');
                return 'engine-a';
            };
        },
    });
    t.after(() => f.close());
    await (await f.client()).command('environment.start', {});
    available = false;
    await f.restart();
    let release!: () => void;
    let entered!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.engine.beforeStop = async () => {
        entered();
        await gate;
    };
    const switching = (await f.client()).command('settings.save', {
        key: 'project',
        value: f.second,
        revision: f.app.snapshot().settingsRevision,
    });
    await cleanupStarted;
    try {
        const saved = await new DaemonState(join(f.root, 'state')).readIntent();
        assert.equal(saved?.switching, true);
        assert.equal(saved?.intent?.running, false);
    } finally {
        release();
        await switching;
    }
    assert.equal(f.app.snapshot().scope.project, f.second);
    assert.equal(f.app.snapshot().live.running, false);
});

test('failed switching checkpoint while recovery is pending blocks cleanup and retains the original checkout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-switch-checkpoint-'));
    const state = new DaemonState(join(directory, 'state'));
    await state.initialize();
    let available = true;
    let cleanup = 0;
    let broken = false;
    const f = await daemonFixture(undefined, undefined, {
        intentStore: {
            readIntent: () => state.readIntent(),
            writeIntent: (intent) => state.writeIntent(intent),
        },
        configure: (backend) => {
            backend.runtime.engineIdentity = async () => {
                if (!available) throw new Error('identity unavailable');
                return 'engine-a';
            };
        },
    });
    try {
        await (await f.client()).command('environment.start', {});
        available = false;
        await f.restart();
        await rename(state.directory, `${state.directory}.saved`);
        await writeFile(state.directory, 'not a directory');
        broken = true;
        f.engine.beforeStop = async () => {
            cleanup++;
        };
        const client = await f.client();
        await assert.rejects(
            client.command('settings.save', {
                key: 'project',
                value: f.second,
                revision: f.app.snapshot().settingsRevision,
            }),
        );
        assert.equal(cleanup, 0);
        assert.equal(f.app.snapshot().scope.project, f.directory);
        assert.equal(
            f.stores.get(f.directory)!.containers[0].lifecycle,
            'running',
        );
        assert.match(f.app.snapshot().notice!, /Cannot save daemon state/);
        await assert.rejects(
            client.command('environment.start', {}),
            /restart the daemon/,
        );
    } finally {
        if (broken) {
            await rm(state.directory);
            await rename(`${state.directory}.saved`, state.directory);
        }
        await f.close();
        await rm(directory, { recursive: true, force: true });
    }
});

for (const decision of ['environment.dismiss', 'environment.cancel'] as const) {
    test(`${decision} after a fresh Start preview cannot become stopped authority after history is trimmed`, async (t) => {
        const stopped: string[] = [];
        const f = await daemonFixture(undefined, undefined, {
            runtime: (base) => ({
                ...base,
                stop: async (targets, context) => {
                    stopped.push(
                        ...targets.map((container) => container.service),
                    );
                    return base.stop(targets, context);
                },
            }),
        });
        t.after(() => f.close());
        const store = f.stores.get(f.directory)!;
        store.containers = ['api', 'obsolete'].map((service) => ({
            id: service,
            service,
            mode: 'Service',
            projectName: 'fixture',
            projectDirectory: f.directory,
            lifecycle: 'running',
            policy: {
                version: 1,
                lazy: false,
                reclaimable: false,
                dependencies: [],
            },
        }));
        const client = await f.client();
        await assert.rejects(
            client.command('environment.start', {}),
            /Starting will stop/,
        );
        await client.command(decision, {});
        const state = new DaemonState(join(f.root, 'state'));
        assert.equal((await state.readIntent())?.intent, undefined);
        await f.operations.close();
        await state.write([]);
        await f.restart();
        await f.controller.poll();
        assert.deepEqual(stopped, []);
        assert.equal(
            store.containers.every(
                (container) => container.lifecycle === 'running',
            ),
            true,
        );
    });
}

test('cancelling a held Start preview never establishes authority before actual activation', async (t) => {
    let hold = false;
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await daemonFixture(undefined, undefined, {
        runtime: (base) => ({
            ...base,
            snapshot: async (signal) => {
                if (hold) {
                    entered = true;
                    await gate;
                }
                return base.snapshot(signal);
            },
        }),
    });
    t.after(async () => {
        hold = false;
        release();
        await f.close();
    });
    const client = await f.client();
    hold = true;
    const starting = await client.submit('environment.start', {});
    await eventually(() => entered);
    const cancelling = await client.submit('environment.cancel', {});
    await eventually(() => f.app.snapshot().live.phase === 'Cancelling');
    hold = false;
    release();
    await assert.rejects(client.wait(starting.id));
    await client.wait(cancelling.id);
    const state = new DaemonState(join(f.root, 'state'));
    assert.equal((await state.readIntent())?.intent, undefined);
    await f.operations.close();
    await state.write([]);
    await f.restart();
    await f.controller.poll();
    assert.equal(f.engine.applies, 0);
    assert.equal(f.app.snapshot().live.running, false);
});
