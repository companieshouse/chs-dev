import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { daemonFixture, eventually } from './daemon-fixture.js';
import { ClientError, protocolVersion } from '../src/protocol/types.js';
import {
    exclusiveLease,
    DaemonState,
} from '../src/infrastructure/daemon-state.js';
import { Operations } from '../src/application/operations.js';
import { commandRequest, queryRequest } from '../src/protocol/schemas.js';

test('accepted work survives disconnect; clients share progress, deduplication and supervision', async () => {
    const f = await daemonFixture();
    try {
        const first = await f.client(),
            second = await f.client();
        let finish!: () => void;
        f.engine.applyGate = new Promise((resolve) => {
            finish = resolve;
        });
        const requestId = randomUUID();
        const operation = await first.submit(
            'environment.start',
            {},
            first.getSnapshot().scope,
            requestId,
        );
        await eventually(() => f.engine.applies === 1);
        const duplicate = await first.submit(
            'environment.start',
            {},
            first.getSnapshot().scope,
            requestId,
        );
        assert.equal(operation.id, duplicate.id);
        await assert.rejects(
            first.submit(
                'environment.stop',
                {},
                first.getSnapshot().scope,
                requestId,
            ),
            /different command/,
        );
        await eventually(() => second.getSnapshot().live.busy);
        const probesDuringBuild = f.engine.probes;
        first.close();
        second.close();
        await eventually(() => f.engine.probes > probesDuringBuild, 3000);
        assert.equal(f.app.snapshot().live.busy, true);
        finish();
        const observer = await f.client();
        await observer.wait(operation.id);
        await eventually(() => observer.getSnapshot().live.phase === 'Running');
        assert.equal(f.engine.applies, 1);
        const third = await f.client();
        assert.equal(third.getSnapshot().live.running, true);
        f.disconnect();
        const probes = f.engine.probes;
        await eventually(() => f.engine.probes > probes, 3000);
        assert.equal(f.app.snapshot().live.running, true);
    } finally {
        await f.close();
    }
});

test('configuration revisions reject edits from a stale frontend', async () => {
    const f = await daemonFixture();
    try {
        const first = await f.client(),
            second = await f.client();
        const revision = first.getSnapshot().configurationRevision;
        await first.command('configuration.save', {
            revision,
            edit: {
                name: 'api',
                enabled: false,
                development: false,
                exclusions: {},
            },
        });
        await assert.rejects(
            second.command('configuration.save', {
                revision,
                edit: {
                    name: 'api',
                    enabled: true,
                    development: false,
                    exclusions: {},
                },
            }),
            /Configuration changed/,
        );
        assert.equal(f.app.snapshot().details.api!.enabled, 'No');
    } finally {
        await f.close();
    }
});

test('checkout switching stops first, preserves data ownership and fences old requests', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        const old = client.getSnapshot().scope;
        await client.command('settings.save', {
            key: 'project',
            value: f.second,
            revision: f.app.snapshot().settingsRevision,
        });
        await eventually(() => client.getSnapshot().scope.project === f.second);
        assert.equal(f.engine.stops, 1);
        assert.equal(f.stores.get(f.directory)!.containers.length, 0);
        assert.equal(client.getSnapshot().live.running, false);
        assert.equal(f.engine.applies, 1);
        await assert.rejects(
            client.command('environment.start', {}, old),
            /checkout or runtime changed/,
        );
        assert.ok(f.stores.has(f.directory));
    } finally {
        await f.close();
    }
});

test('failed Stop leaves the original checkout selected', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        f.engine.failStop = true;
        await assert.rejects(
            client.command('settings.save', {
                key: 'project',
                value: f.second,
                revision: f.app.snapshot().settingsRevision,
            }),
            /not switched/,
        );
        assert.equal(f.app.snapshot().scope.project, f.directory);
        assert.equal(
            f.app.snapshot().settings.startup.project.value,
            f.directory,
        );
        assert.equal(f.stores.has(f.second), false);
    } finally {
        await f.close();
    }
});

test('daemon recovery restores intent within a login but a new login requires Start', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        await client.command('service.action', {
            services: ['api'],
            action: 'stop',
        });
        await f.restart();
        assert.deepEqual(f.app.snapshot().live.stoppedByUser, ['api']);
        const applies = f.engine.applies;
        await f.restart(true);
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(f.engine.applies, applies);
        const monitors = f.engine.monitors;
        await f.app.query({
            scope: f.app.snapshot().scope,
            query: 'refresh',
            args: {},
        });
        assert.equal(f.engine.monitors, monitors);
    } finally {
        await f.close();
    }
});

test('kernel leases reject competing owners and can reuse a stale pathname', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-lease-test-'));
    try {
        const path = join(directory, 'owner.lock');
        const release = await exclusiveLease(path);
        await assert.rejects(exclusiveLease(path), /Another daemon/);
        await release();
        const again = await exclusiveLease(path);
        await again();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('interrupted commands are recorded without replaying or persisting secret arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-operation-test-'));
    try {
        const store = new DaemonState(directory);
        await store.initialize();
        const operations = new Operations(store, () => {});
        await operations.initialize();
        const request = commandRequest({
            protocol: protocolVersion,
            clientId: 'test',
            requestId: 'private-input',
            scope: { project: '/fixture', generation: 'first' },
            command: 'ssh.setup',
            args: {
                keyPath: '/private/key',
                passphrase: 'do-not-record-this',
                replace: false,
            },
        });
        let complete!: () => void;
        const pending = new Promise<void>((resolve) => {
            complete = resolve;
        });
        const operation = await operations.submit(
            request,
            () => {},
            async () => pending,
        );
        await eventually(
            () => operations.get(operation.id).state === 'running',
        );
        const persisted = await readFile(
            join(directory, 'operations.json'),
            'utf8',
        );
        assert.equal(persisted.includes('do-not-record-this'), false);
        assert.equal(persisted.includes('/private/key'), false);
        const recovery = new Operations(store, () => {});
        await recovery.initialize();
        assert.equal(recovery.get(operation.id).state, 'interrupted');
        complete();
        await operations.close();
        await recovery.close();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('protocol rejects unexpected fields and invalid lifecycle input', () => {
    assert.throws(
        () =>
            commandRequest({
                protocol: protocolVersion,
                clientId: 'c',
                requestId: 'r',
                scope: { project: '/x', generation: 'g' },
                command: 'environment.stop',
                args: { volumes: true },
            }),
        /Unknown request field/,
    );
    assert.throws(
        () =>
            queryRequest({
                scope: { project: '/x', generation: 'g' },
                query: 'containers.logs',
                args: { id: 'api', tail: 100000 },
            }),
        /Tail must/,
    );
});

test('clients reconnect with a fresh snapshot without replaying commands or duplicating logs', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        const generation = client.getSnapshot().scope.generation;
        const logs = [...client.getSnapshot().live.logs];
        let disconnected = false;
        const unsubscribe = client.subscribe(() => {
            if (client.getSnapshot().connection === 'reconnecting')
                disconnected = true;
        });
        await f.reconnectTransport();
        await eventually(
            () =>
                disconnected && client.getSnapshot().connection === 'connected',
        );
        unsubscribe();
        assert.equal(client.getSnapshot().scope.generation, generation);
        assert.equal(f.engine.applies, 1);
        assert.deepEqual(client.getSnapshot().live.logs, logs);
    } finally {
        await f.close();
    }
});

test('unknown state versions are rejected without overwriting saved work', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-version-test-'));
    try {
        const state = new DaemonState(directory);
        await state.initialize();
        const contents = JSON.stringify({ version: 99, records: [] });
        await writeFile(join(directory, 'operations.json'), contents);
        await assert.rejects(
            state.read(),
            /Unsupported daemon operation history/,
        );
        assert.equal(
            await readFile(join(directory, 'operations.json'), 'utf8'),
            contents,
        );
        await writeFile(
            join(directory, 'session.json'),
            JSON.stringify({ version: 99 }),
        );
        await assert.rejects(
            state.readIntent(),
            /Unsupported daemon session state/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('saving an unrelated setting does not activate an externally edited checkout', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        await writeFile(
            join(f.root, 'settings.yaml'),
            `project: ${f.second}\n`,
        );
        await client.query('refresh', {});
        assert.equal(
            f.app.snapshot().settings.resolved.project.value,
            f.second,
        );
        await client.command('settings.save', {
            key: 'loginAction',
            value: 'aws',
            revision: f.app.snapshot().settingsRevision,
        });
        assert.equal(f.app.snapshot().scope.project, f.directory);
        assert.equal(f.engine.stops, 0);
        assert.ok(f.app.snapshot().settings.restartPending.includes('project'));
    } finally {
        await f.close();
    }
});

test('saving a journey writes the file into the checkout', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        const result = await client.command('project.saveJourney', {
            name: 'pilot',
            services: ['api'],
            lazy: [],
        });
        assert.match(result.path, /journeys[\\/]pilot\.yaml$/);
        assert.equal(
            await readFile(result.path, 'utf8'),
            'services:\n  - api\n',
        );
        await assert.rejects(
            client.command('project.saveJourney', {
                name: 'pilot',
                services: ['api'],
                lazy: ['api'],
            }),
            /in both services and lazy/,
        );
    } finally {
        await f.close();
    }
});

test('journey list reports the journeys in the checkout', async () => {
    const f = await daemonFixture();
    try {
        const client = await f.client();
        const empty = await client.query('journey.list', {});
        assert.deepEqual(empty, { journeys: [], invalid: [] });
        await client.command('project.saveJourney', {
            name: 'accounts',
            services: ['api'],
            lazy: [],
        });
        const listed = await client.query('journey.list', {});
        assert.deepEqual(listed, {
            journeys: [
                { name: 'accounts', services: ['api'], lazy: [], excluded: [] },
            ],
            invalid: [],
        });
    } finally {
        await f.close();
    }
});

test('Environment Stop durably records stopped intent before issuing cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chs-stop-order-'));
    const intents = new DaemonState(join(root, 'intent-store'));
    await intents.initialize();
    const f = await daemonFixture(undefined, undefined, {
        intentStore: intents,
    });
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        await intents.flush();
        const persisted: boolean[] = [];
        f.engine.beforeStop = async () => {
            persisted.push(
                JSON.parse(
                    readFileSync(
                        join(intents.directory, 'session.json'),
                        'utf8',
                    ),
                ).intent.running,
            );
        };
        await client.command('environment.stop', {});
        assert.deepEqual(persisted, [false]);
        assert.equal(f.engine.stops, 1);
        assert.equal((await intents.readIntent())?.intent?.running, false);
    } finally {
        await f.close();
        await rm(root, { recursive: true, force: true });
    }
});

test('failed stopped-intent persistence blocks cleanup and reports an incomplete Stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chs-stop-storage-'));
    const intents = new DaemonState(join(root, 'intent-store'));
    await intents.initialize();
    const f = await daemonFixture(undefined, undefined, {
        intentStore: intents,
    });
    let unavailable = false;
    try {
        const client = await f.client();
        await client.command('environment.start', {});
        await intents.flush();
        await rename(intents.directory, `${intents.directory}.saved`);
        await writeFile(intents.directory, 'storage unavailable');
        unavailable = true;
        await assert.rejects(client.command('environment.stop', {}));
        assert.equal(f.app.snapshot().live.running, false);
        assert.equal(f.engine.stops, 0);
        assert.equal(f.stores.get(f.directory)!.containers.length, 1);
        assert.match(
            f.app.snapshot().live.message,
            /persist.*stopped intent|Stop incomplete/i,
        );
    } finally {
        if (unavailable) {
            await rm(intents.directory);
            await rename(`${intents.directory}.saved`, intents.directory);
        }
        await f.close();
        await rm(root, { recursive: true, force: true });
    }
});

test('Stop owns mutation throughout slow intent persistence and joins repeated Stop commands', async () => {
    for (const applyInFlight of [false, true]) {
        const root = await mkdtemp(join(tmpdir(), 'chs-stop-owner-'));
        const intents = new DaemonState(join(root, 'intent-store'));
        await intents.initialize();
        let hold = false;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const intentStore = {
            readIntent: () => intents.readIntent(),
            writeIntent: async (
                value: Parameters<DaemonState['writeIntent']>[0],
            ) => {
                if (hold && value.intent?.running === false) await gate;
                await intents.writeIntent(value);
            },
        };
        const f = await daemonFixture(undefined, undefined, { intentStore });
        let releaseApply = () => {};
        try {
            const first = await f.client(),
                second = await f.client();
            if (applyInFlight)
                f.engine.applyGate = new Promise<void>((resolve) => {
                    releaseApply = resolve;
                });
            const starting = await first.submit('environment.start', {});
            await eventually(() => f.engine.applies === 1);
            if (!applyInFlight) {
                await first.wait(starting.id);
                await intents.flush();
            }
            hold = true;
            const stop = await first.submit('environment.stop', {});
            await eventually(() => f.app.snapshot().live.running === false);
            if (applyInFlight)
                await eventually(
                    () => f.app.snapshot().live.phase === 'Blocked',
                );
            assert.equal(f.app.snapshot().live.busy, true);
            assert.equal(f.app.snapshot().live.action, 'stop');
            assert.equal(
                (await f.controller.coldStart('api', Date.now() + 50)).ok,
                false,
            );
            await assert.rejects(
                second.submit('environment.start', {}),
                (error: any) => error.detail.code === 'BUSY',
            );
            await assert.rejects(
                second.submit('service.action', {
                    services: ['api'],
                    action: 'restart',
                }),
                (error: any) => error.detail.code === 'BUSY',
            );
            const repeated = await second.submit('environment.stop', {});
            assert.equal(f.engine.stops, 0);
            release();
            await first.wait(stop.id);
            await second.wait(repeated.id);
            if (applyInFlight)
                await assert.rejects(
                    first.wait(starting.id),
                    /superseded|cancel/i,
                );
            assert.equal(f.engine.stops, 1);
            assert.equal(f.app.snapshot().live.running, false);
            assert.equal(f.app.snapshot().live.busy, false);
        } finally {
            release();
            releaseApply();
            await f.close();
            await rm(root, { recursive: true, force: true });
        }
    }
});
