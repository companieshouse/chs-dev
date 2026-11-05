import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
    createProxyServer,
    type ProxyServerOptions,
} from '../src/proxy/server.js';
import { createAccounting } from '../src/proxy/accounting.js';
import { createLazyLifecycle, type ProxyLog } from '../src/proxy/lifecycle.js';
import type { Route } from '../src/proxy/routes.js';

function route(
    service: string,
    host: string,
    healthcheckPaths: string[] = [],
): Route {
    return {
        router: `${service}-router`,
        service,
        port: 8080,
        priority: 10,
        matches: (candidateHost) => candidateHost === host,
        healthcheckPaths,
    };
}

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as { port: number };
            resolve(address.port);
        });
    });
}

function get(
    port: number,
    host: string,
    path: string,
): Promise<{
    status: number | undefined;
    body: string;
    echoedPath: string | undefined;
}> {
    return new Promise((resolve, reject) => {
        const request = http.get(
            { host: '127.0.0.1', port, headers: { host }, path },
            (response) => {
                let body = '';
                response.on('data', (chunk) => (body += chunk));
                response.on('end', () =>
                    resolve({
                        status: response.statusCode,
                        body,
                        echoedPath: response.headers['x-echo-path'] as
                            string | undefined,
                    }),
                );
            },
        );
        request.on('error', reject);
    });
}

test('the proxy streams matched requests to the routed upstream', async (t) => {
    const seen: { path: string | undefined; host: string | undefined }[] = [];
    const upstream = http.createServer((request, response) => {
        seen.push({ path: request.url, host: request.headers.host });
        response.writeHead(200, { 'x-echo-path': request.url ?? '' });
        response.end(`hello from ${request.url}`);
    });
    const upstreamPort = await listen(upstream);
    t.after(() => upstream.close());

    const options: ProxyServerOptions = {
        routes: async () => [
            route(
                'accounts-filing-web',
                'find-and-file.company-information.service.chs.local',
            ),
        ],
        upstream: async () => ({ host: '127.0.0.1', port: upstreamPort }),
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);

    const hit = await get(
        proxyPort,
        'find-and-file.company-information.service.chs.local',
        '/filing-history',
    );
    assert.equal(hit.status, 200);
    assert.equal(hit.body, 'hello from /filing-history');
    assert.equal(hit.echoedPath, '/filing-history');
    assert.deepEqual(seen, [
        {
            path: '/filing-history',
            host: '127.0.0.1:' + upstreamPort,
        },
    ]);
});

test('an unknown route answers 404 naming the missing route', async (t) => {
    const upstream = http.createServer((request, response) => response.end());
    const upstreamPort = await listen(upstream);
    t.after(() => upstream.close());
    const options: ProxyServerOptions = {
        routes: async () => [
            route(
                'accounts-filing-web',
                'find-and-file.company-information.service.chs.local',
            ),
        ],
        upstream: async () => ({ host: '127.0.0.1', port: upstreamPort }),
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);

    const miss = await get(proxyPort, 'other.chs.local', '/nowhere');
    assert.equal(miss.status, 404);
    assert.equal(miss.body, 'No route for other.chs.local/nowhere');
});

test('a missing or failing upstream answers 502 naming the service', async (t) => {
    const options: ProxyServerOptions = {
        routes: async () => [route('felixvalidator', 'api.chs.local')],
        upstream: async () => undefined,
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);
    const missing = await get(proxyPort, 'api.chs.local', '/xbrl-validate');
    assert.equal(missing.status, 502);
    assert.equal(missing.body, 'No upstream for felixvalidator');

    const dead: ProxyServerOptions = {
        routes: async () => [route('felixvalidator', 'api.chs.local')],
        upstream: async () => ({ host: '127.0.0.1', port: 1 }),
    };
    const failing = createProxyServer(dead);
    const failingPort = await listen(failing);
    t.after(() => failing.close());
    await delay(50);
    const failed = await get(failingPort, 'api.chs.local', '/xbrl-validate');
    assert.equal(failed.status, 502);
    assert.match(failed.body, /Upstream felixvalidator failed/);
});

test('request accounting counts traffic and excludes healthcheck probes', async (t) => {
    const upstream = http.createServer((request, response) =>
        response.end('ok'),
    );
    const upstreamPort = await listen(upstream);
    t.after(() => upstream.close());
    const accounting = createAccounting();
    const options: ProxyServerOptions = {
        routes: async () => [
            route(
                'accounts-filing-web',
                'find-and-file.company-information.service.chs.local',
                ['/accounts-filing/healthcheck'],
            ),
        ],
        upstream: async () => ({ host: '127.0.0.1', port: upstreamPort }),
        accounting,
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);

    await get(
        proxyPort,
        'find-and-file.company-information.service.chs.local',
        '/filing-history',
    );
    await get(
        proxyPort,
        'find-and-file.company-information.service.chs.local',
        '/accounts-filing',
    );
    await get(
        proxyPort,
        'find-and-file.company-information.service.chs.local',
        '/accounts-filing/healthcheck',
    );
    await get(proxyPort, 'unknown.chs.local', '/nowhere');
    assert.deepEqual(accounting.snapshot(), {
        counts: { 'accounts-filing-web': 2 },
        excluded: { 'accounts-filing-web': 1 },
    });
});

test('cold starts and hold caps emit structured proxy events', async (t) => {
    const logged: Array<Parameters<ProxyLog>> = [];
    const options: ProxyServerOptions = {
        routes: async () => [route('felixvalidator', 'api.chs.local')],
        upstream: async () => undefined,
        lifecycle: {
            isLazy: () => true,
            touch: () => {},
            seen: () => {},
            start: async () => {},
            stop: async () => {},
            sweep: async () => [],
        },
        holdMs: 40,
        pollMs: 10,
        log: (message, event) => logged.push([message, event]),
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);
    await get(proxyPort, 'api.chs.local', '/xbrl-validate');

    const causes = logged.map(
        ([, event]) => `${event?.cause}:${event?.status}:${event?.service}`,
    );
    assert.deepEqual(causes, [
        'cold-start:start:felixvalidator',
        'hold-cap:failed:felixvalidator',
    ]);
});

test('a stopped lazy service cold-starts, holds, and is served once reachable', async (t) => {
    const upstream = http.createServer((request, response) =>
        response.end('cold start ok'),
    );
    const upstreamPort = await listen(upstream);
    t.after(() => upstream.close());
    let startCalls = 0;
    let upstreamAvailable = false;
    const options: ProxyServerOptions = {
        routes: async () => [route('felixvalidator', 'api.chs.local')],
        upstream: async () =>
            upstreamAvailable
                ? { host: '127.0.0.1', port: upstreamPort }
                : undefined,
        lifecycle: {
            isLazy: (service) => service === 'felixvalidator',
            touch: () => {},
            seen: () => {},
            start: async (service) => {
                startCalls++;
                upstreamAvailable = true;
            },
            stop: async () => {},
            sweep: async () => [],
        },
        pollMs: 20,
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);

    const served = await get(proxyPort, 'api.chs.local', '/xbrl-validate');
    assert.equal(served.status, 200);
    assert.equal(served.body, 'cold start ok');
    assert.equal(startCalls, 1);
});

test('concurrent requests to a stopped lazy service start it once', async (t) => {
    const upstream = http.createServer((request, response) =>
        response.end('ok'),
    );
    const upstreamPort = await listen(upstream);
    t.after(() => upstream.close());
    let startCalls = 0;
    let upstreamAvailable = false;
    const options: ProxyServerOptions = {
        routes: async () => [route('felixvalidator', 'api.chs.local')],
        upstream: async () =>
            upstreamAvailable
                ? { host: '127.0.0.1', port: upstreamPort }
                : undefined,
        lifecycle: createLazyLifecycle({
            isLazy: () => true,
            start: async () => {
                startCalls++;
                await delay(50);
                upstreamAvailable = true;
            },
            stop: async () => {},
        }),
        pollMs: 10,
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);

    const responses = await Promise.all([
        get(proxyPort, 'api.chs.local', '/a'),
        get(proxyPort, 'api.chs.local', '/b'),
        get(proxyPort, 'api.chs.local', '/c'),
    ]);
    assert.deepEqual(
        responses.map((response) => response.status),
        [200, 200, 200],
    );
    assert.equal(startCalls, 1);
});

test('an upstream that never becomes reachable returns 503 still starting', async (t) => {
    let startCalls = 0;
    const options: ProxyServerOptions = {
        routes: async () => [route('felixvalidator', 'api.chs.local')],
        upstream: async () => undefined,
        lifecycle: {
            isLazy: () => true,
            touch: () => {},
            seen: () => {},
            start: async () => {
                startCalls++;
            },
            stop: async () => {},
            sweep: async () => [],
        },
        holdMs: 60,
        pollMs: 10,
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);

    const held = await get(proxyPort, 'api.chs.local', '/xbrl-validate');
    assert.equal(held.status, 503);
    assert.equal(
        held.body,
        'Service felixvalidator is still starting - try again shortly.',
    );
    assert.equal(startCalls, 1);
});

test('a failed cold start answers 502', async (t) => {
    const options: ProxyServerOptions = {
        routes: async () => [route('felixvalidator', 'api.chs.local')],
        upstream: async () => undefined,
        lifecycle: {
            isLazy: () => true,
            touch: () => {},
            seen: () => {},
            start: async () => {
                throw new Error('start failed');
            },
            stop: async () => {},
            sweep: async () => [],
        },
    };
    const proxy = createProxyServer(options);
    const proxyPort = await listen(proxy);
    t.after(() => proxy.close());
    await delay(50);

    const failed = await get(proxyPort, 'api.chs.local', '/xbrl-validate');
    assert.equal(failed.status, 502);
    assert.equal(failed.body, 'Service felixvalidator could not be started.');
});
