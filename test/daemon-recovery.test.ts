import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DaemonState } from '../src/infrastructure/daemon-state.js';
import { daemonFixture, eventually } from './daemon-fixture.js';

test('clean recovery resumes an applied eager service without activating pending saved selection', async () => {
    const started: string[] = [];
    const f = await daemonFixture(undefined, undefined, {
        runtime: (base) => ({
            ...base,
            startApplied: async (service, context) => {
                started.push(service);
                return base.startApplied(service, context);
            },
        }),
    });
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        const store = f.stores.get(f.directory)!;
        store.enabled = false;
        store.revision++;
        store.containers[0].lifecycle = 'exited';
        await f.restart(true);
        await eventually(
            () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
        );
        assert.equal(f.app.snapshot().live.running, true);
        assert.deepEqual(started, ['api']);
        assert.equal(f.engine.applies, 1);
        assert.equal(store.enabled, false);
        assert.equal(store.containers[0].lifecycle, 'running');
        await f.restart();
        await eventually(
            () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
        );
        assert.deepEqual(
            started,
            ['api'],
            'an already running root does not replay completed dependency jobs',
        );
    } finally {
        await f.close();
    }
});

test('changed engine identity permits inspection but no automatic start or stop', async () => {
    let identity = 'engine-a';
    let mutations = 0;
    const f = await daemonFixture(undefined, undefined, {
        configure: (backend) => {
            backend.runtime.engineIdentity = async () => identity;
        },
        runtime: (base) => ({
            ...base,
            startApplied: async (...args) => {
                mutations++;
                return base.startApplied(...args);
            },
            stop: async (...args) => {
                if (args[0].length) mutations++;
                return base.stop(...args);
            },
        }),
    });
    try {
        await (await f.client()).command('environment.start', {});
        identity = 'engine-b';
        await f.restart(true);
        await eventually(() =>
            /identity.*changed/.test(f.app.snapshot().notice ?? ''),
        );
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(mutations, 0);
        assert.throws(
            () => f.controller.assertTrafficAllowed('api'),
            /stopped/,
        );
        assert.match(f.app.snapshot().notice!, /identity.*changed/);
    } finally {
        await f.close();
    }
});

test('unavailable engine preserves the durable checkpoint until read-only identity retry matches', async () => {
    let unavailable = false;
    let starts = 0;
    const f = await daemonFixture(undefined, undefined, {
        configure: (backend) => {
            backend.runtime.engineIdentity = async () => {
                if (unavailable) throw new Error('engine offline');
                return 'engine-a';
            };
        },
        runtime: (base) => ({
            ...base,
            startApplied: async (...args) => {
                starts++;
                return base.startApplied(...args);
            },
        }),
    });
    try {
        await (await f.client()).command('environment.start', {});
        f.stores.get(f.directory)!.containers[0].lifecycle = 'exited';
        unavailable = true;
        await f.restart(true);
        const persisted = await new DaemonState(
            join(f.root, 'state'),
        ).readIntent();
        assert.equal(persisted?.intent?.running, true);
        assert.equal(persisted?.engineIdentity, 'engine-a');
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(starts, 0);
        assert.throws(
            () => f.controller.assertTrafficAllowed('api'),
            /stopped/,
        );
        unavailable = false;
        await eventually(() => f.app.snapshot().live.running);
        assert.equal(starts, 1);
        assert.equal(f.engine.applies, 1);
    } finally {
        await f.close();
    }
});

test('clean restored manual holds stop engine-restarted containers before warm traffic is admitted', async () => {
    let stopped = 0;
    const f = await daemonFixture(undefined, undefined, {
        runtime: (base) => ({
            ...base,
            stop: async (...args) => {
                if (args[0].length) stopped++;
                return base.stop(...args);
            },
        }),
    });
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        await client.command('service.action', {
            action: 'stop',
            services: ['api'],
        });
        const api = f.stores.get(f.directory)!.containers[0];
        api.lifecycle = 'running'; // restart:always can revive this container after an engine reboot.
        await f.restart(true);
        await eventually(() => stopped === 1 && !f.app.snapshot().live.busy);
        assert.equal(stopped, 1);
        assert.equal(api.lifecycle, 'running'); // external engine fixture replaces snapshots rather than mutating this reference.
        assert.equal(
            f.stores.get(f.directory)!.containers[0].lifecycle,
            'exited',
        );
        assert.deepEqual(f.app.snapshot().live.stoppedByUser, ['api']);
        assert.throws(
            () => f.controller.assertTrafficAllowed('api'),
            /manually stopped/,
        );
        assert.equal(f.engine.applies, 1);
    } finally {
        await f.close();
    }
});

test('interrupted checkpoints never replay mutations even when a held container has restarted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-recovery-state-'));
    const state = new DaemonState(directory);
    await state.initialize();
    let interrupted = false;
    let mutations = 0;
    const f = await daemonFixture(undefined, undefined, {
        intentStore: {
            readIntent: async () => {
                const saved = await state.readIntent();
                return saved && interrupted
                    ? { ...saved, interrupted: true }
                    : saved;
            },
            writeIntent: (intent) => state.writeIntent(intent),
        },
        runtime: (base) => ({
            ...base,
            startApplied: async (...args) => {
                mutations++;
                return base.startApplied(...args);
            },
            stop: async (...args) => {
                if (args[0].length) mutations++;
                return base.stop(...args);
            },
        }),
    });
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        await client.command('service.action', {
            action: 'stop',
            services: ['api'],
        });
        f.stores.get(f.directory)!.containers[0].lifecycle = 'running';
        interrupted = true;
        await f.restart(true);
        await eventually(
            () =>
                f.controller.getIntent().paused && !f.app.snapshot().live.busy,
        );
        assert.equal(mutations, 0);
        assert.equal(f.controller.getIntent().paused, true);
        assert.throws(() => f.controller.assertTrafficAllowed('api'), /paused/);
        assert.match(f.app.snapshot().live.message, /not replayed/);
    } finally {
        await f.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test('a fresh daemon never adopts existing containers just by observing and restarting twice', async () => {
    const f = await daemonFixture();
    try {
        const store = f.stores.get(f.directory)!;
        store.containers.push({
            id: 'existing',
            service: 'api',
            projectName: 'fixture',
            projectDirectory: f.directory,
            lifecycle: 'running',
            policy: {
                version: 1,
                lazy: false,
                reclaimable: false,
                dependencies: [],
            },
        });
        await f.restart();
        await f.restart(true);
        assert.equal(store.containers[0].lifecycle, 'running');
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(f.engine.applies, 0);
    } finally {
        await f.close();
    }
});

for (const kind of ['environment.stop', 'environment.cancel'] as const) {
    test(`failed latest ${kind} gates recovery by acceptance time even when an older Start completed later`, async () => {
        let starts = 0;
        let stops = 0;
        const f = await daemonFixture(undefined, undefined, {
            runtime: (base) => ({
                ...base,
                startApplied: async (...args) => {
                    starts++;
                    return base.startApplied(...args);
                },
                stop: async (...args) => {
                    if (args[0].length) stops++;
                    return base.stop(...args);
                },
            }),
        });
        try {
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
                    id: 'failed-stop',
                    requestId: 'failed-stop',
                    kind,
                    state: 'failed',
                    createdAt: '2026-01-01T00:00:01.000Z',
                    updatedAt: '2026-01-01T00:00:02.000Z',
                },
            ]);
            await f.restart(true);
            await eventually(
                () =>
                    f.controller.getIntent().paused &&
                    !f.app.snapshot().live.busy,
            );
            assert.equal(starts, 0);
            assert.equal(stops, 0);
            assert.equal(f.controller.getIntent().paused, true);
            assert.equal(
                f.app.snapshot().live.running,
                kind === 'environment.cancel',
            );
            assert.equal(
                f.stores.get(f.directory)!.containers[0].lifecycle,
                'running',
            );
            assert.throws(
                () => f.controller.assertTrafficAllowed('api'),
                /stopped|paused/,
            );
        } finally {
            await f.close();
        }
    });
}

test('a successful start result cannot hide an eager service that remained stopped', async () => {
    const f = await daemonFixture(undefined, undefined, {
        runtime: (base) => ({
            ...base,
            startApplied: async () => ({
                outcome: 'success',
                message: 'claimed success',
                affectedServices: ['api'],
            }),
        }),
    });
    try {
        await (await f.client()).command('environment.start', {});
        f.stores.get(f.directory)!.containers[0].lifecycle = 'exited';
        await f.restart(true);
        await eventually(
            () =>
                f.controller.getIntent().paused && !f.app.snapshot().live.busy,
        );
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(f.controller.getIntent().paused, true);
        assert.match(f.app.snapshot().live.message, /api is still stopped/);
    } finally {
        await f.close();
    }
});

test('rejected service requests preserve recovery and explicit Stop supersedes a pending durable recovery checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-recovery-preemption-'));
    const state = new DaemonState(directory);
    await state.initialize();
    let available = true;
    let armed = false;
    let entered = false;
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let serial = Promise.resolve();
    const f = await daemonFixture(undefined, undefined, {
        configure: (backend) => {
            backend.runtime.engineIdentity = async () => {
                if (!available) throw new Error('engine unavailable');
                return 'engine-a';
            };
        },
        intentStore: {
            readIntent: () => state.readIntent(),
            writeIntent: (intent) => {
                serial = serial.then(async () => {
                    if (armed && intent.interrupted && intent.intent?.running) {
                        entered = true;
                        await gate;
                    }
                    await state.writeIntent(intent);
                });
                return serial;
            },
        },
        runtime: (base) => ({
            ...base,
            startApplied: async (...args) => {
                starts++;
                return base.startApplied(...args);
            },
        }),
    });
    try {
        await (await f.client()).command('environment.start', {});
        f.stores.get(f.directory)!.containers[0].lifecycle = 'exited';
        available = false;
        await f.restart(true);
        const client = await f.client();
        await assert.rejects(
            client.command('service.action', {
                action: 'start',
                services: ['api'],
            }),
            /identity.*checked/,
        );
        assert.equal((await state.readIntent())?.intent?.running, true);
        armed = true;
        available = true;
        await eventually(() => entered);
        const stop = await client.submit('environment.stop', {});
        await eventually(() => f.app.snapshot().live.action === 'stop');
        assert.equal(starts, 0);
        assert.equal(f.engine.stops, 0);
        release();
        await client.wait(stop.id);
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(starts, 0);
        assert.equal(f.engine.stops, 1);
        assert.equal((await state.readIntent())?.intent?.running, false);
    } finally {
        release();
        await f.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test('the API remains available during initial recovery and Stop preempts a late engine success', async () => {
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const f = await daemonFixture(undefined, undefined, {
        runtime: (base) => ({
            ...base,
            startApplied: async (...args) => {
                entered = true;
                await gate; // model an adapter which ignores abort and returns a late success.
                return base.startApplied(...args);
            },
        }),
    });
    let restarting: Promise<void> | undefined;
    try {
        await (await f.client()).command('environment.start', {});
        f.stores.get(f.directory)!.containers[0].lifecycle = 'exited';
        restarting = f.restart(true);
        let timer: ReturnType<typeof setTimeout>;
        try {
            await Promise.race([
                restarting,
                new Promise<void>((_resolve, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    'API startup waited for held recovery work',
                                ),
                            ),
                        1000,
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer!);
        }
        const client = await f.client();
        await eventually(() => entered);
        await eventually(() => client.getSnapshot().live.busy);
        assert.match(client.getSnapshot().live.activity!, /Restoring/);
        const stop = await client.submit('environment.stop', {});
        await eventually(() => f.app.snapshot().live.action === 'stop');
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(f.engine.stops, 0);
        release();
        await client.wait(stop.id);
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(f.app.snapshot().live.phase, 'Stopped');
        assert.equal(f.controller.getIntent().paused, false);
        assert.equal(f.engine.stops, 1);
        assert.equal(f.stores.get(f.directory)!.containers.length, 0);
    } finally {
        release();
        await restarting;
        await f.close();
    }
});

test('clean running recovery does not resurrect an old deselected logical service', async () => {
    const started: string[] = [];
    const f = await daemonFixture(undefined, undefined, {
        runtime: (base) => ({
            ...base,
            startApplied: async (service, context) => {
                started.push(service);
                return base.startApplied(service, context);
            },
        }),
    });
    try {
        await (await f.client()).command('environment.start', {});
        const store = f.stores.get(f.directory)!;
        store.containers.push({
            ...store.containers[0],
            id: 'old-worker',
            service: 'old-worker',
            lifecycle: 'exited',
        });
        await f.restart(true);
        await eventually(
            () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
        );
        assert.deepEqual(started, []);
        assert.equal(
            store.containers.find(
                (container) => container.service === 'old-worker',
            )!.lifecycle,
            'exited',
        );
        assert.equal(f.app.snapshot().live.running, true);
    } finally {
        await f.close();
    }
});

test('clean stopped intent re-stops an engine-restarted owned container without resuming anything', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        const old = { ...f.stores.get(f.directory)!.containers[0] };
        await client.command('environment.stop', {});
        f.stores
            .get(f.directory)!
            .containers.push({ ...old, lifecycle: 'running' });
        await f.restart(true);
        await eventually(
            () =>
                f.stores.get(f.directory)!.containers[0].lifecycle ===
                    'exited' && !f.app.snapshot().live.busy,
        );
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(f.controller.getIntent().paused, false);
        assert.equal(
            f.stores.get(f.directory)!.containers[0].lifecycle,
            'exited',
        );
        assert.equal(f.engine.applies, 1);
        assert.throws(
            () => f.controller.assertTrafficAllowed('api'),
            /stopped/,
        );
    } finally {
        await f.close();
    }
});

test('empty applied membership remains deliberate after restart with no containers', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        await client.command('configuration.save', {
            revision: client.getSnapshot().configurationRevision,
            edit: {
                name: 'api',
                enabled: false,
                development: false,
                exclusions: {},
            },
        });
        await client.command('environment.start', {});
        assert.deepEqual(f.controller.getIntent().appliedServices, []);
        await f.restart(true);
        await eventually(
            () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
        );
        assert.equal(f.app.snapshot().live.running, true);
        assert.equal(f.controller.getIntent().paused, false);
        assert.deepEqual(f.controller.getIntent().appliedServices, []);
        assert.equal(f.engine.applies, 0);
        assert.equal(f.stores.get(f.directory)!.containers.length, 0);
    } finally {
        await f.close();
    }
});

test('switching and legacy membership checkpoints require explicit reconciliation without automatic mutations', async () => {
    for (const legacy of [false, true]) {
        const directory = await mkdtemp(join(tmpdir(), 'chs-recovery-gate-'));
        const state = new DaemonState(directory);
        await state.initialize();
        let rewrite = false;
        let mutations = 0;
        const f = await daemonFixture(undefined, undefined, {
            intentStore: {
                readIntent: async () => {
                    const saved = await state.readIntent();
                    if (!saved || !rewrite) return saved;
                    return legacy
                        ? {
                              ...saved,
                              intent: {
                                  ...saved.intent!,
                                  appliedServices: undefined,
                              },
                          }
                        : { ...saved, switching: true };
                },
                writeIntent: (intent) => state.writeIntent(intent),
            },
            runtime: (base) => ({
                ...base,
                stop: async (...args) => {
                    if (args[0].length) mutations++;
                    return base.stop(...args);
                },
                startApplied: async (...args) => {
                    mutations++;
                    return base.startApplied(...args);
                },
            }),
        });
        try {
            await (await f.client()).command('environment.start', {});
            f.stores.get(f.directory)!.containers[0].lifecycle = 'exited';
            rewrite = true;
            await f.restart(true);
            await eventually(
                () =>
                    f.controller.getIntent().paused &&
                    !f.app.snapshot().live.busy,
            );
            assert.equal(mutations, 0);
            assert.equal(f.controller.getIntent().paused, true);
            assert.throws(
                () => f.controller.assertTrafficAllowed('api'),
                /paused|stopped/,
            );
            assert.match(
                f.app.snapshot().live.message,
                legacy ? /membership.*unavailable/ : /not replayed/,
            );
        } finally {
            await f.close();
            await rm(directory, { recursive: true, force: true });
        }
    }
});

test('a failed durable recovery checkpoint blocks mutations until repaired storage and daemon restart', async () => {
    const directory = await mkdtemp(
        join(tmpdir(), 'chs-recovery-write-failure-'),
    );
    const state = new DaemonState(join(directory, 'state'));
    await state.initialize();
    let armed = false;
    let broken = false;
    let starts = 0;
    const f = await daemonFixture(undefined, undefined, {
        intentStore: {
            readIntent: () => state.readIntent(),
            writeIntent: async (intent) => {
                if (armed && intent.interrupted && !broken) {
                    await rename(state.directory, `${state.directory}.saved`);
                    await writeFile(
                        state.directory,
                        'directory replaced by a file',
                    );
                    broken = true;
                }
                await state.writeIntent(intent);
            },
        },
        runtime: (base) => ({
            ...base,
            startApplied: async (...args) => {
                starts++;
                return base.startApplied(...args);
            },
        }),
    });
    try {
        await (await f.client()).command('environment.start', {});
        f.stores.get(f.directory)!.containers[0].lifecycle = 'exited';
        armed = true;
        await f.restart(true);
        await eventually(() =>
            /Cannot save daemon state/.test(f.app.snapshot().notice ?? ''),
        );
        assert.equal(starts, 0);
        await rm(state.directory);
        await rename(`${state.directory}.saved`, state.directory);
        broken = false;
        armed = false;
        await new Promise((resolve) => {
            setTimeout(resolve, 2200);
        });
        assert.equal(
            starts,
            0,
            'the existing persistence failure latch also gates automatic recovery',
        );
        assert.equal((await state.readIntent())?.intent?.running, true);
        await assert.rejects(
            (await f.client()).command('environment.start', {}),
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

test('Cancel durably pauses pending recovery without losing applied membership or manual holds', async () => {
    let available = true;
    let identityReads = 0;
    let starts = 0;
    const f = await daemonFixture(undefined, undefined, {
        configure: (backend) => {
            backend.runtime.engineIdentity = async () => {
                identityReads++;
                if (!available) throw new Error('engine unavailable');
                return 'engine-a';
            };
        },
        runtime: (base) => ({
            ...base,
            startApplied: async (...args) => {
                starts++;
                return base.startApplied(...args);
            },
        }),
    });
    try {
        await (await f.client()).command('environment.start', {});
        const store = f.stores.get(f.directory)!;
        store.containers[0].lifecycle = 'exited';
        store.containers.push({
            ...store.containers[0],
            id: 'old-held',
            service: 'old-held',
        });
        await (
            await f.client()
        ).command('service.action', { action: 'stop', services: ['old-held'] });
        available = false;
        await f.restart(true);
        const client = await f.client();
        await client.command('environment.cancel', {});
        const saved = await new DaemonState(join(f.root, 'state')).readIntent();
        assert.deepEqual(saved?.intent?.appliedServices, ['api']);
        assert.deepEqual(saved?.intent?.stoppedByUser, ['old-held']);
        assert.equal(saved?.intent?.paused, true);
        const before = identityReads;
        available = true;
        await eventually(() => identityReads > before);
        await new Promise((resolve) => {
            setTimeout(resolve, 200);
        });
        assert.equal(starts, 0);
        assert.equal(f.controller.getIntent().paused, true);
        assert.deepEqual(f.controller.getIntent().stoppedByUser, ['old-held']);
        await f.restart();
        await eventually(
            () =>
                f.controller.getIntent().paused && !f.app.snapshot().live.busy,
        );
        assert.equal(starts, 0);
        assert.deepEqual(f.controller.getIntent().appliedServices, ['api']);
        assert.deepEqual(f.controller.getIntent().stoppedByUser, ['old-held']);
        await (await f.client()).command('environment.start', {});
        assert.equal(f.engine.applies, 2);
        assert.equal(f.controller.getIntent().paused, false);
    } finally {
        await f.close();
    }
});
