import assert from 'node:assert/strict';
import { test } from 'node:test';
import { streamLogs } from '../src/client/logs.js';
import { runCli } from '../src/cli/run.js';
import type {
    ContainerManager,
    ContainerSummary,
} from '../src/domain/containers.js';
import { daemonFixture, eventually } from './daemon-fixture.js';

function logManager() {
    const calls: { id: string; tail: number | 'all'; follow: boolean }[] = [];
    const receivers = new Map<string, (text: string) => void>();
    const container = (
        id: string,
        service: string,
        currentProject = true,
    ): ContainerSummary => ({
        id,
        service,
        currentProject,
        name: id,
        image: 'fixture',
        state: 'running',
        status: 'Running',
        ports: [],
    });
    const containers = [
        container('api', 'api'),
        { ...container('builder', 'api-builder'), ownerService: 'api' },
        container('foreign', 'api', false),
    ];
    const manager: ContainerManager = {
        list: async () => containers,
        inspect: async () => {
            throw new Error('Unexpected inspection');
        },
        logs: async () => {
            throw new Error('Snapshot logs must not be used for streams');
        },
        action: async () => {
            throw new Error('Unexpected action');
        },
        streamLogs: async (target, options, context) => {
            calls.push({ id: target.id, ...options });
            const emit = (text: string) =>
                context.onOutput?.({ stream: 'stdout', text });
            if (options.tail !== 0) {
                emit('repeat');
                emit('repeat');
            }
            if (!options.follow) return;
            receivers.set(target.id, emit);
            await new Promise<void>((resolve) => {
                context.signal!.addEventListener(
                    'abort',
                    () => {
                        receivers.delete(target.id);
                        resolve();
                    },
                    { once: true },
                );
                if (context.signal!.aborted) {
                    receivers.delete(target.id);
                    resolve();
                }
            });
        },
    };
    return { manager, calls, receivers };
}

test('service log streams select exact checkout containers and preserve repeated lines', async () => {
    const logs = logManager(),
        f = await daemonFixture(undefined, logs.manager);
    try {
        let output = '';
        const code = await runCli(['legacy', 'logs', 'api', '-n', 'all'], {
            connect: f.client,
            out: (text) => {
                output += text;
            },
        });
        assert.equal(code, 0);
        assert.deepEqual(logs.calls.map((call) => call.id).sort(), [
            'api',
            'builder',
        ]);
        assert.equal(
            output.split('\n').filter((line) => line === 'api | repeat').length,
            2,
        );
        assert.equal(
            output.split('\n').filter((line) => line === 'api-builder | repeat')
                .length,
            2,
        );
        assert.deepEqual(f.app.snapshot().diagnostics?.lines ?? [], []);
    } finally {
        await f.close();
    }
});

test('follow with zero tail starts at new output and disconnect aborts every owned stream', async () => {
    const logs = logManager(),
        f = await daemonFixture(undefined, logs.manager);
    const signal = new AbortController();
    try {
        const client = await f.client(),
            rows: { service?: string; text: string }[] = [];
        const pending = streamLogs(
            client.socket,
            {
                scope: client.getSnapshot().scope,
                source: 'services',
                services: ['api'],
                tail: 0,
                follow: true,
            },
            (entry) => rows.push(entry),
            signal.signal,
        );
        const finished = pending.catch((error) => error);
        await eventually(() => logs.receivers.size === 2);
        assert.deepEqual(rows, []);
        logs.receivers.get('api')!('new line');
        await eventually(() => rows.length === 1);
        signal.abort(new Error('closed by subscriber'));
        assert.match((await finished).message, /closed by subscriber/);
        await eventually(() => logs.receivers.size === 0);
    } finally {
        signal.abort();
        await f.close();
    }
});

test('environment log follow uses sequence numbers and closes safely when a checkout changes', async () => {
    const f = await daemonFixture(),
        signal = new AbortController();
    try {
        const client = await f.client(),
            rows: { text: string }[] = [];
        const pending = streamLogs(
            client.socket,
            {
                scope: client.getSnapshot().scope,
                source: 'environment',
                services: [],
                tail: 0,
                follow: true,
            },
            (entry) => rows.push(entry),
            signal.signal,
        );
        const ended = pending.catch((error) => error);
        await new Promise((resolve) => {
            setTimeout(resolve, 30);
        });
        await client.command('environment.start', {});
        await eventually(() =>
            rows.some((row) => row.text.includes('Completed:')),
        );
        await client.command('settings.save', {
            key: 'project',
            value: f.second,
            revision: f.app.snapshot().settingsRevision,
        });
        assert.equal((await ended).detail.code, 'STALE_PROJECT');
    } finally {
        signal.abort();
        await f.close();
    }
});

test('log streams reject unknown services before streaming and daemon shutdown drains readers', async () => {
    const logs = logManager(),
        f = await daemonFixture(undefined, logs.manager),
        signal = new AbortController();
    try {
        const client = await f.client();
        const request = {
            scope: client.getSnapshot().scope,
            source: 'services' as const,
            services: ['missing'],
            tail: 'all' as const,
            follow: false,
        };
        await assert.rejects(
            streamLogs(client.socket, request, () => {}, signal.signal),
            (error: any) => error.detail.code === 'UNKNOWN_SERVICE',
        );
        const pending = streamLogs(
            client.socket,
            { ...request, services: [], follow: true },
            () => {},
            signal.signal,
        ).catch((error) => error);
        await eventually(() => logs.receivers.size === 2);
        await f.reconnectTransport();
        await pending;
        assert.equal(logs.receivers.size, 0);
    } finally {
        signal.abort();
        await f.close();
    }
});

test('one engine stream failure aborts and drains its siblings before reporting the error', async () => {
    const logs = logManager();
    let drained = false;
    logs.manager.streamLogs = async (target, _options, context) => {
        if (target.id === 'builder') {
            await new Promise((resolve) => {
                setImmediate(resolve);
            });
            throw new Error('Engine stream failed');
        }
        await new Promise<void>((resolve) => {
            context.signal!.addEventListener(
                'abort',
                () => {
                    drained = true;
                    resolve();
                },
                { once: true },
            );
        });
    };
    const f = await daemonFixture(undefined, logs.manager);
    try {
        const client = await f.client();
        await assert.rejects(
            streamLogs(
                client.socket,
                {
                    scope: client.getSnapshot().scope,
                    source: 'services',
                    services: ['api'],
                    tail: 0,
                    follow: true,
                },
                () => {},
                new AbortController().signal,
            ),
            /Engine stream failed/,
        );
        assert.equal(drained, true);
    } finally {
        await f.close();
    }
});

test('a slow log reader is disconnected before unbounded output can queue', async () => {
    const logs = logManager();
    let produced = 0;
    logs.manager.streamLogs = async (_target, _options, context) => {
        for (let index = 0; index < 10000; index++) {
            context.signal!.throwIfAborted();
            produced++;
            context.onOutput?.({ stream: 'stdout', text: 'x'.repeat(1000) });
        }
    };
    const f = await daemonFixture(undefined, logs.manager);
    try {
        const client = await f.client();
        await assert.rejects(
            streamLogs(
                client.socket,
                {
                    scope: client.getSnapshot().scope,
                    source: 'services',
                    services: ['api'],
                    tail: 'all',
                    follow: false,
                },
                () => {},
                new AbortController().signal,
            ),
        );
        assert.ok(produced < 5000, `${produced} lines produced`);
        assert.equal(f.app.snapshot().ready, true);
    } finally {
        await f.close();
    }
});
