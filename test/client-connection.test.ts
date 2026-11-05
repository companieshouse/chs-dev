import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer, type RequestListener } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { requestJson, openEvents } from '../src/client/connection.js';
import { ClientError } from '../src/protocol/types.js';
import type { StreamEvent } from '../src/client/event-stream.js';

async function serve(t: TestContext, handler: RequestListener) {
    const directory = await mkdtemp(join(tmpdir(), 'chs-http-'));
    const socket = join(directory, 'api.sock');
    const server = createServer(handler);
    t.after(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
        await rm(directory, { recursive: true, force: true });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
    });
    return socket;
}

test('JSON requests preserve Unicode body lengths, method and parsed response', async (t) => {
    const socket = await serve(t, (req, res) => {
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/query');
        assert.equal(req.headers['content-type'], 'application/json');
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            assert.equal(
                Number(req.headers['content-length']),
                Buffer.byteLength(body),
            );
            res.end(JSON.stringify({ received: JSON.parse(body) }));
        });
    });
    const value = { name: 'café', enabled: true };
    assert.deepEqual(await requestJson(socket, '/query', 'POST', value), {
        received: value,
    });
});

test('JSON responses retain daemon errors, default errors and invalid response failures', async (t) => {
    const detail = {
        code: 'STALE_REVISION',
        message: 'Refresh before editing.',
    };
    const socket = await serve(t, (req, res) => {
        res.statusCode = 409;
        if (req.url === '/detail') res.end(JSON.stringify({ error: detail }));
        else if (req.url === '/fallback') res.end('{}');
        else res.end('invalid JSON');
    });
    await assert.rejects(requestJson(socket, '/detail'), (error) => {
        assert.ok(error instanceof ClientError);
        assert.deepEqual(error.detail, detail);
        return true;
    });
    await assert.rejects(requestJson(socket, '/fallback'), (error) => {
        assert.ok(error instanceof ClientError);
        assert.deepEqual(error.detail, {
            code: 'DAEMON_ERROR',
            message: 'Daemon request failed.',
        });
        return true;
    });
    await assert.rejects(
        requestJson(socket, '/invalid'),
        /daemon returned an invalid response/,
    );
});

test(
    'JSON requests abort in-flight responses',
    { timeout: 5000 },
    async (t) => {
        const started = Promise.withResolvers<void>();
        const disconnected = Promise.withResolvers<void>();
        const socket = await serve(t, (req, res) => {
            res.write('{');
            res.on('close', disconnected.resolve);
            started.resolve();
        });
        const abort = new AbortController();
        const pending = requestJson(
            socket,
            '/slow',
            'GET',
            undefined,
            abort.signal,
        );
        const rejected = assert.rejects(pending, { name: 'AbortError' });
        await started.promise;
        abort.abort();
        await rejected;
        await disconnected.promise;
    },
);

test(
    'oversized JSON responses terminate the request before parsing',
    { timeout: 5000 },
    async (t) => {
        const socket = await serve(t, (_, res) => {
            res.end(' '.repeat(33 * 1024 * 1024));
        });
        await assert.rejects(
            requestJson(socket, '/oversized'),
            /Daemon response is too large/,
        );
    },
);

test(
    'event subscriptions send the cursor and decode fragmented UTF-8 frames before closing once',
    { timeout: 5000 },
    async (t) => {
        const socket = await serve(t, (req, res) => {
            assert.equal(req.headers['last-event-id'], 'previous');
            res.setHeader('content-type', 'text/event-stream');
            const first = Buffer.from(
                'event: snapshot\nid: 42\ndata: {"name":"café"}\n\n',
            );
            const split = first.indexOf(Buffer.from('é')) + 1;
            res.write(first.subarray(0, split));
            setImmediate(() => {
                res.end(
                    Buffer.concat([
                        first.subarray(split),
                        Buffer.from(': keepalive\n\ndata: [1,2]\n\n'),
                    ]),
                );
            });
        });
        const events: StreamEvent[] = [];
        const closed = Promise.withResolvers<Error | undefined>();
        let closes = 0;
        const cancel = openEvents(
            socket,
            '/events',
            (type, data, id) => {
                events.push({ type, data, id });
            },
            (error) => {
                closes++;
                closed.resolve(error);
            },
            'previous',
        );
        t.after(cancel);
        assert.equal(await closed.promise, undefined);
        await delay(20);
        assert.equal(closes, 1);
        assert.deepEqual(events, [
            { type: 'snapshot', data: { name: 'café' }, id: '42' },
            { type: 'message', data: [1, 2], id: undefined },
        ]);
    },
);

test(
    'event subscriptions close once on HTTP and decoding errors',
    { timeout: 5000 },
    async (t) => {
        const socket = await serve(t, (req, res) => {
            if (req.url === '/unavailable') {
                res.statusCode = 503;
                res.end('unavailable');
            } else res.end('data: invalid\n\ndata: 2\n\n');
        });
        for (const path of ['/unavailable', '/invalid']) {
            const closed = Promise.withResolvers<Error | undefined>();
            let closes = 0;
            const values: unknown[] = [];
            const cancel = openEvents(
                socket,
                path,
                (_, value) => values.push(value),
                (error) => {
                    closes++;
                    closed.resolve(error);
                },
            );
            t.after(cancel);
            const error = await closed.promise;
            assert.ok(error instanceof Error);
            if (path === '/unavailable')
                assert.match(error.message, /HTTP 503/);
            else assert.ok(error instanceof SyntaxError);
            await delay(20);
            assert.equal(closes, 1);
            assert.deepEqual(values, []);
        }
    },
);

test(
    'event handler errors terminate consumption and explicit cancellation suppresses close notification',
    { timeout: 5000 },
    async (t) => {
        const started = Promise.withResolvers<void>();
        const disconnected = Promise.withResolvers<void>();
        const socket = await serve(t, (req, res) => {
            if (req.url === '/handler') res.end('data: 1\n\ndata: 2\n\n');
            else {
                res.on('close', disconnected.resolve);
                res.write(': keepalive\n\n');
                started.resolve();
            }
        });
        const failure = new Error('handler failed');
        const closed = Promise.withResolvers<Error | undefined>();
        let calls = 0;
        t.after(
            openEvents(
                socket,
                '/handler',
                () => {
                    calls++;
                    throw failure;
                },
                closed.resolve,
            ),
        );
        assert.equal(await closed.promise, failure);
        assert.equal(calls, 1);
        let closes = 0;
        const cancel = openEvents(
            socket,
            '/cancel',
            () => {},
            () => {
                closes++;
            },
        );
        t.after(cancel);
        await started.promise;
        cancel();
        await disconnected.promise;
        await delay(20);
        assert.equal(closes, 0);
    },
);
