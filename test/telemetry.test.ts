import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import { test } from 'node:test';
import {
    createTelemetry,
    telemetryConfiguration,
} from '../src/infrastructure/telemetry.js';
import { validateEvent } from './fixtures/telemetry-events.js';
import { readFile } from 'node:fs/promises';

const installId = '306c010c-a36e-4efe-a4b2-a51dfbd07eaf';

async function receiver(
    handle?: (request: IncomingMessage, response: ServerResponse) => void,
) {
    const events: unknown[] = [];
    const server = createServer(
        handle ??
            ((request, response) => {
                let body = '';
                request.setEncoding('utf8');
                request.on('data', (chunk) => {
                    body += chunk;
                });
                request.on('end', () => {
                    events.push(...JSON.parse(body));
                    response.writeHead(202).end();
                });
            }),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return {
        events,
        endpoint: `http://127.0.0.1:${address.port}/events`,
        close: async () => {
            server.closeAllConnections();
            server.close();
            await once(server, 'close');
        },
    };
}

async function eventually(check: () => boolean, timeout = 3000) {
    const end = Date.now() + timeout;
    while (!check()) {
        assert.ok(Date.now() < end, 'Telemetry condition timed out');
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
    }
}

test('opt-in client sends only allowlisted operation fields accepted by actual ingest schema', async () => {
    // Pinned schemaVersion=1 snapshot from the sibling ingest on 2026-11-05.
    const sibling = await readFile(
        new URL(
            '../../chs-dev-telemetry-server/src/schema/events.ts',
            import.meta.url,
        ),
        'utf8',
    ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    });
    const pinned = await readFile(
        new URL('./fixtures/telemetry-events.ts', import.meta.url),
        'utf8',
    );
    if (sibling !== undefined)
        assert.equal(
            pinned,
            sibling,
            'Pinned telemetry contract must match the actual ingest schema.',
        );
    const server = await receiver();
    const client = createTelemetry({
        enabled: true,
        endpoint: server.endpoint,
        installId,
    });
    try {
        client.record({
            command: 'environment.start',
            state: 'succeeded',
            durationMs: 123,
            environment: { TOKEN: 'private-value' },
            args: ['private-path'],
            message: 'private-error',
        } as any);
        await eventually(() => server.events.length === 1);
        assert.deepEqual(
            server.events.map((event) => validateEvent(event).ok),
            [true],
        );
        const event = server.events[0] as Record<string, unknown>;
        assert.equal(event.command, 'environment.start');
        assert.equal(event.durationMs, 123);
        assert.equal(event.exitCode, 0);
        assert.equal(event.installId, installId);
        assert.equal(JSON.stringify(event).includes('private-'), false);
        assert.deepEqual(Object.keys(event).sort(), [
            'command',
            'durationMs',
            'exitCode',
            'installId',
            'schemaVersion',
            'timestamp',
            'type',
        ]);
    } finally {
        client.close();
        await server.close();
    }
});

test('shared application reports each accepted operation once, including failures, to the real HTTP client', async () => {
    const { daemonFixture } = await import('./daemon-fixture.js');
    const server = await receiver();
    const telemetry = createTelemetry({
        enabled: true,
        endpoint: server.endpoint,
        installId,
    });
    const fixture = await daemonFixture(undefined, undefined, {
        completed: (completion) => telemetry.record(completion),
    });
    try {
        const client = await fixture.client();
        const scope = client.getSnapshot().scope;
        const operation = await client.submit(
            'environment.start',
            {},
            scope,
            'one-request',
        );
        await client.wait(operation.id);
        assert.equal(
            (await client.submit('environment.start', {}, scope, 'one-request'))
                .id,
            operation.id,
        );
        fixture.engine.failStop = true;
        await assert.rejects(client.command('environment.stop', {}));
        await eventually(() => server.events.length === 3);
        for (const event of server.events)
            assert.equal(validateEvent(event).ok, true);
        assert.deepEqual(
            server.events.map((event: any) => event.type),
            ['command-completed', 'command-completed', 'error-occurred'],
        );
        assert.deepEqual(
            server.events.map((event: any) => event.exitCode),
            [0, 1, undefined],
        );
        const text = JSON.stringify(server.events);
        assert.equal(text.includes(fixture.directory), false);
        assert.equal(text.includes('Fixture Stop failed'), false);
        assert.equal(text.includes('one-request'), false);
    } finally {
        await fixture.close();
        telemetry.close();
        await server.close();
    }
});

test('collection is disabled without explicit opt-in and endpoint, UUID and transport validation fail closed', async (context) => {
    const clients: ReturnType<typeof createTelemetry>[] = [];
    context.after(() => {
        for (const client of clients) client.close();
    });
    let sends = 0;
    const send = async () => {
        sends++;
    };
    const base = {
        CHS_DEV_TELEMETRY_ENDPOINT: 'https://telemetry.example/events',
        CHS_DEV_TELEMETRY_INSTALL_ID: installId,
    };
    for (const env of [
        base,
        { ...base, CHS_DEV_TELEMETRY: 'off' },
        { ...base, CHS_DEV_TELEMETRY: 'on', DO_NOT_TRACK: '1' },
    ]) {
        assert.equal(telemetryConfiguration(env), undefined);
        const client = createTelemetry(telemetryConfiguration(env), send);
        client.record({
            command: 'environment.start',
            state: 'succeeded',
            durationMs: 1,
        });
        clients.push(client);
    }
    for (const configuration of [
        {
            enabled: false,
            endpoint: base.CHS_DEV_TELEMETRY_ENDPOINT,
            installId,
        },
        {
            enabled: true,
            endpoint: base.CHS_DEV_TELEMETRY_ENDPOINT,
            installId: 'developer@example.com',
        },
        {
            enabled: true,
            endpoint: 'http://telemetry.example/events',
            installId,
        },
        {
            enabled: true,
            endpoint: 'https://user:password@telemetry.example/events',
            installId,
        },
        {
            enabled: true,
            endpoint: 'https://telemetry.example/events?token=private',
            installId,
        },
        {
            enabled: true,
            endpoint: 'https://telemetry.example/events#private',
            installId,
        },
        { enabled: true, endpoint: 'not-a-url', installId },
        {
            enabled: true,
            endpoint: 'https://telemetry.example/other',
            installId,
        },
    ]) {
        const client = createTelemetry(configuration, send);
        client.record({
            command: 'environment.start',
            state: 'succeeded',
            durationMs: 1,
        });
        clients.push(client);
    }
    await new Promise((resolve) => {
        setTimeout(resolve, 1100);
    });
    assert.equal(sends, 0);
});

test('failed event fields use a fixed error message and code allowlist; unknown commands are dropped', async () => {
    const server = await receiver();
    const client = createTelemetry({
        enabled: true,
        endpoint: server.endpoint,
        installId,
    });
    try {
        client.record({
            command: 'private-command',
            state: 'failed',
            durationMs: 1,
            errorCode: 'private-code',
        });
        client.record({
            command: 'environment.start',
            state: 'failed',
            durationMs: 5.6,
            errorCode: 'private-code',
            message: 'private-error',
            environment: { AWS_TOKEN: 'private-token' },
        } as any);
        await eventually(() => server.events.length === 2);
        for (const event of server.events)
            assert.equal(validateEvent(event).ok, true);
        assert.equal(JSON.stringify(server.events).includes('private-'), false);
        assert.equal((server.events[0] as any).durationMs, 6);
        assert.equal((server.events[1] as any).message, 'Operation failed.');
        assert.equal((server.events[1] as any).errorCode, 'OPERATION_FAILED');
    } finally {
        client.close();
        await server.close();
    }
});

test('buffer is bounded, batches are limited, and failed batches are never retried', async () => {
    const batches: readonly any[][] = [];
    const client = createTelemetry(
        {
            enabled: true,
            endpoint: 'https://telemetry.example/events',
            installId,
        },
        async (_endpoint, events) => {
            (batches as any[]).push(events);
            throw new Error('private-transport-error');
        },
    );
    try {
        for (let index = 0; index < 100; index++)
            client.record({
                command: 'environment.start',
                state: 'succeeded',
                durationMs: index,
            });
        await eventually(() => batches.length === 3, 4000);
        assert.deepEqual(
            batches.map((batch) => batch.length),
            [20, 20, 10],
        );
        assert.deepEqual(
            batches.flat().map((event) => event.durationMs),
            Array.from({ length: 50 }, (_, index) => index),
        );
    } finally {
        client.close();
    }
});

test('an observer throwing private details cannot change a successful application operation', async () => {
    const { daemonFixture } = await import('./daemon-fixture.js');
    const fixture = await daemonFixture(undefined, undefined, {
        completed: () => {
            throw new Error('private-observer-error');
        },
    });
    try {
        const client = await fixture.client();
        await client.command('environment.start', {});
        assert.equal(fixture.operations.list().at(-1)!.state, 'succeeded');
        assert.equal(fixture.operations.list().at(-1)!.error, undefined);
    } finally {
        await fixture.close();
    }
});

test('native transport has an absolute request deadline and does not follow redirects', async () => {
    let started = false,
        disconnected = false;
    const stalled = await receiver((request) => {
        started = true;
        request.resume();
        request.socket.once('close', () => {
            disconnected = true;
        });
    });
    const timed = createTelemetry({
        enabled: true,
        endpoint: stalled.endpoint,
        installId,
    });
    try {
        timed.record({
            command: 'environment.start',
            state: 'succeeded',
            durationMs: 1,
        });
        await eventually(() => started);
        await eventually(() => disconnected, 2000);
    } finally {
        timed.close();
        await stalled.close();
    }
    const target = await receiver();
    let redirects = 0;
    const redirect = await receiver((request, response) => {
        redirects++;
        request.resume();
        response.writeHead(307, { location: target.endpoint }).end();
    });
    const client = createTelemetry({
        enabled: true,
        endpoint: redirect.endpoint,
        installId,
    });
    try {
        client.record({
            command: 'environment.start',
            state: 'succeeded',
            durationMs: 1,
        });
        await eventually(() => redirects === 1);
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });
        assert.equal(target.events.length, 0);
    } finally {
        client.close();
        await redirect.close();
        await target.close();
    }
});

test('close discards pending events and immediately cancels an active native request', async () => {
    let started = 0,
        disconnected = false;
    const server = await receiver((request) => {
        started++;
        request.resume();
        request.socket.once('close', () => {
            disconnected = true;
        });
    });
    const config = { enabled: true, endpoint: server.endpoint, installId };
    const pending = createTelemetry(config);
    pending.record({
        command: 'environment.start',
        state: 'succeeded',
        durationMs: 1,
    });
    pending.close();
    const active = createTelemetry(config);
    try {
        active.record({
            command: 'environment.stop',
            state: 'succeeded',
            durationMs: 1,
        });
        await eventually(() => started === 1);
        active.close();
        await eventually(() => disconnected, 500);
        active.record({
            command: 'environment.start',
            state: 'succeeded',
            durationMs: 1,
        });
        assert.equal(started, 1);
    } finally {
        active.close();
        await server.close();
    }
});

test('a rejected asynchronous observer is isolated from application outcomes', async () => {
    const { daemonFixture } = await import('./daemon-fixture.js');
    const fixture = await daemonFixture(undefined, undefined, {
        completed: async () => {
            throw new Error('private-async-observer-error');
        },
    });
    try {
        const client = await fixture.client();
        await client.command('environment.start', {});
        assert.equal(fixture.operations.list().at(-1)!.state, 'succeeded');
    } finally {
        await fixture.close();
    }
});

test('real receiver failures leave application commands successful without retrying the batch', async () => {
    const { daemonFixture } = await import('./daemon-fixture.js');
    let attempts = 0;
    const server = await receiver((request, response) => {
        request.resume();
        request.on('end', () => {
            attempts++;
            response.writeHead(503).end('private-receiver-failure');
        });
    });
    const telemetry = createTelemetry({
        enabled: true,
        endpoint: server.endpoint,
        installId,
    });
    const fixture = await daemonFixture(undefined, undefined, {
        completed: (completion) => telemetry.record(completion),
    });
    try {
        const client = await fixture.client();
        await client.command('environment.start', {});
        assert.equal(fixture.operations.list().at(-1)!.state, 'succeeded');
        await eventually(() => attempts === 1);
        await new Promise((resolve) => {
            setTimeout(resolve, 1100);
        });
        assert.equal(attempts, 1);
        assert.equal(fixture.operations.list().at(-1)!.error, undefined);
    } finally {
        await fixture.close();
        telemetry.close();
        await server.close();
    }
});

test('application cancellation reports only a cancelled completion through native transport', async () => {
    const { daemonFixture } = await import('./daemon-fixture.js');
    const server = await receiver();
    const telemetry = createTelemetry({
        enabled: true,
        endpoint: server.endpoint,
        installId,
    });
    const fixture = await daemonFixture(undefined, undefined, {
        completed: (completion) => telemetry.record(completion),
    });
    try {
        fixture.engine.applyGate = new Promise(() => {});
        const client = await fixture.client();
        const operation = await client.submit('environment.start', {});
        await eventually(() => fixture.engine.applies === 1);
        fixture.operations.cancel(operation.id);
        await assert.rejects(client.wait(operation.id));
        await eventually(() => server.events.length === 1);
        assert.equal((server.events[0] as any).exitCode, 130);
        assert.equal((server.events[0] as any).type, 'command-completed');
        assert.equal(validateEvent(server.events[0]).ok, true);
    } finally {
        await fixture.close();
        telemetry.close();
        await server.close();
    }
});

test('login startup retains only valid opt-in configuration and strips private endpoint material', async () => {
    const { daemonEnvironment } =
        await import('../src/daemon-control/environment.js');
    const { launchAgentPlist } =
        await import('../src/daemon-control/macos/launch-agent.js');
    const env = {
        CHS_DEV_TELEMETRY: 'on',
        CHS_DEV_TELEMETRY_ENDPOINT: 'https://telemetry.example/events',
        CHS_DEV_TELEMETRY_INSTALL_ID: installId,
    };
    assert.equal(daemonEnvironment(env).CHS_DEV_TELEMETRY, 'on');
    assert.equal(
        daemonEnvironment(env).CHS_DEV_TELEMETRY_ENDPOINT,
        env.CHS_DEV_TELEMETRY_ENDPOINT,
    );
    assert.equal(
        daemonEnvironment(env).CHS_DEV_TELEMETRY_INSTALL_ID,
        installId,
    );
    assert.equal(
        daemonEnvironment({ ...env, DO_NOT_TRACK: '1' }).CHS_DEV_TELEMETRY,
        'off',
    );
    assert.equal(daemonEnvironment({}).CHS_DEV_TELEMETRY, 'off');
    const privateEnv = {
        ...env,
        CHS_DEV_TELEMETRY_ENDPOINT:
            'https://user:private-startup-token@telemetry.example/events?private-query',
    };
    const plist = launchAgentPlist(privateEnv);
    assert.equal(plist.includes('private-startup-token'), false);
    assert.equal(plist.includes('private-query'), false);
    assert.equal(daemonEnvironment(privateEnv).CHS_DEV_TELEMETRY, 'off');
});

test('login startup persists only the normalized validated telemetry URL', async () => {
    const { launchAgentPlist } =
        await import('../src/daemon-control/macos/launch-agent.js');
    const endpoint = 'https://telemetry.example/private-path-token/../events';
    const plist = launchAgentPlist({
        CHS_DEV_TELEMETRY: 'on',
        CHS_DEV_TELEMETRY_ENDPOINT: endpoint,
        CHS_DEV_TELEMETRY_INSTALL_ID: installId,
    });
    assert.equal(plist.includes('private-path-token'), false);
    assert.match(
        plist,
        /<key>CHS_DEV_TELEMETRY_ENDPOINT<\/key><string>https:\/\/telemetry\.example\/events<\/string>/,
    );
});

test('rejected requests and restored interrupted operations emit no new completion telemetry', async () => {
    const { daemonFixture } = await import('./daemon-fixture.js');
    const { Operations } = await import('../src/application/operations.js');
    const server = await receiver();
    const telemetry = createTelemetry({
        enabled: true,
        endpoint: server.endpoint,
        installId,
    });
    const fixture = await daemonFixture(undefined, undefined, {
        completed: (completion) => telemetry.record(completion),
    });
    const recovered = new Operations(
        {
            read: async () => [
                {
                    id: 'private-recovered-operation',
                    requestId: 'private-recovered-request',
                    clientId: 'private-recovered-client',
                    kind: 'environment.start',
                    state: 'running',
                    fingerprint: 'private-fingerprint',
                    scope: {
                        project: '/private-recovered-project',
                        generation: 'old-generation',
                    },
                    createdAt: '2026-11-05T00:00:00.000Z',
                    updatedAt: '2026-11-05T00:00:01.000Z',
                },
            ],
            write: async () => {},
            fingerprint: () => 'unused',
            id: () => 'unused',
        },
        () => {},
        (completion) => telemetry.record(completion),
    );
    try {
        const client = await fixture.client();
        await assert.rejects(
            client.submit(
                'environment.stop',
                {},
                { project: fixture.directory, generation: 'stale-generation' },
            ),
        );
        assert.equal(fixture.operations.list().length, 0);
        await recovered.initialize();
        assert.equal(
            recovered.get('private-recovered-operation').state,
            'interrupted',
        );
        await new Promise((resolve) => {
            setTimeout(resolve, 1100);
        });
        assert.equal(server.events.length, 0);
        await client.command('environment.start', {});
        await eventually(() => server.events.length === 1);
        assert.equal((server.events[0] as any).command, 'environment.start');
        assert.equal(
            JSON.stringify(server.events).includes('private-recovered'),
            false,
        );
    } finally {
        await recovered.close();
        await fixture.close();
        telemetry.close();
        await server.close();
    }
});
