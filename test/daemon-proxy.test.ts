import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { startDaemonProxy } from '../src/server/proxy-service.js';
import type { RuntimeStrategy } from '../src/domain/runtime-strategy.js';
import type {
    ContainerDetails,
    ContainerManager,
} from '../src/domain/containers.js';
import { daemonFixture, eventually } from './daemon-fixture.js';

async function listen(server: http.Server): Promise<number> {
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    return (server.address() as { port: number }).port;
}

function request(port: number) {
    return new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
            http.get(
                { host: '127.0.0.1', port, headers: { host: 'api.chs.local' } },
                (response) => {
                    let body = '';
                    response.on('data', (chunk) => {
                        body += chunk;
                    });
                    response.on('end', () =>
                        resolve({ status: response.statusCode, body }),
                    );
                },
            ).on('error', reject);
        },
    );
}

test('daemon proxy uses applied route metadata across repeated requests and saved external edits', async (t) => {
    const f = await daemonFixture();
    t.after(() => f.close());
    await (await f.client()).command('environment.start', {});
    let hits = 0;
    const upstream = http.createServer((_request, response) => {
        hits++;
        response.end('applied api');
    });
    const upstreamPort = await listen(upstream);
    t.after(
        () =>
            new Promise<void>((resolve) => {
                upstream.close(() => resolve());
            }),
    );
    const reservation = http.createServer();
    const port = await listen(reservation);
    await new Promise<void>((resolve) => {
        reservation.close(() => resolve());
    });
    const container: ContainerDetails = {
        id: 'api-1',
        name: 'api',
        service: 'api',
        image: 'api:1',
        state: 'running',
        status: 'Running',
        currentProject: true,
        ports: [],
        mounts: [],
        networks: [{ name: 'chs', addresses: ['127.0.0.1'] }],
        inspection: {
            Config: {
                Labels: {
                    'traefik.http.routers.api.rule': 'Host(`api.chs.local`)',
                    'traefik.http.services.api.loadbalancer.server.port':
                        '8080',
                    'chs.dev.lifecycle':
                        '{"version":1,"lazy":true,"reclaimable":false,"dependencies":[]}',
                },
            },
            NetworkSettings: {
                Ports: {
                    '8080/tcp': [
                        { HostIp: '127.0.0.1', HostPort: String(upstreamPort) },
                    ],
                },
            },
        },
    };
    const manager: ContainerManager = {
        list: async () => [container],
        inspect: async () => container,
        logs: async () => [],
        action: async () => {
            throw new Error('Unexpected engine action');
        },
    };
    const proxy = startDaemonProxy({
        runtime: () =>
            ({ containers: () => manager }) as unknown as RuntimeStrategy,
        controller: () => f.controller,
        portOverride: port,
    });
    t.after(() => proxy.close());
    await proxy.listening;
    assert.deepEqual(await request(port), { status: 200, body: 'applied api' });
    await mkdir(f.directory, { recursive: true });
    await writeFile(join(f.directory, '.chs-dev.yaml'), 'services: []\n');
    assert.deepEqual(await request(port), { status: 200, body: 'applied api' });
    assert.deepEqual(proxy.state().lazy, ['api']);
    await f.restart();
    assert.deepEqual(proxy.state().lazy, []);
    await eventually(
        () => f.app.snapshot().live.running && !f.app.snapshot().live.busy,
    );
    assert.deepEqual(await request(port), { status: 200, body: 'applied api' });
    assert.deepEqual(proxy.state().lazy, ['api']);
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
    await client.command('environment.apply', {});
    assert.equal(
        (await request(port)).status,
        503,
        'old warm labels cannot bypass deselection',
    );
    container.state = 'exited';
    assert.equal(
        (await request(port)).status,
        503,
        'old lazy labels cannot cold-start a deselected service',
    );
    assert.equal(hits, 3);
    assert.equal(f.engine.applies, 1);
});

test('real proxy traffic reports manual holds without releasing shared daemon intent', async (t) => {
    let hits = 0;
    const upstream = http.createServer((_request, response) => {
        hits++;
        response.end('allowed upstream');
    });
    const upstreamPort = await listen(upstream);
    t.after(
        () =>
            new Promise<void>((resolve) => {
                upstream.close(() => resolve());
            }),
    );
    const f = await daemonFixture();
    t.after(() => f.close());
    const client = await f.client();
    await client.command('environment.start', {});
    const store = f.stores.get(f.directory)!;
    store.containers[0]!.policy = {
        version: 1,
        lazy: true,
        reclaimable: false,
        dependencies: [],
    };
    await client.command('service.action', {
        services: ['api'],
        action: 'stop',
    });
    const details = (): ContainerDetails => ({
        id: store.containers[0]!.id,
        name: 'api',
        service: 'api',
        image: 'api:1',
        state: store.containers[0]!.lifecycle,
        status: 'Stopped',
        currentProject: true,
        ports: [],
        mounts: [],
        networks: [],
        inspection: {
            Config: {
                Labels: {
                    'traefik.http.routers.api.rule': 'Host(`api.chs.local`)',
                    'traefik.http.services.api.loadbalancer.server.port':
                        '8080',
                    'chs.dev.lifecycle': JSON.stringify(
                        store.containers[0]!.policy,
                    ),
                },
            },
            NetworkSettings: {
                Ports: {
                    '8080/tcp': [
                        { HostIp: '127.0.0.1', HostPort: String(upstreamPort) },
                    ],
                },
            },
        },
    });
    const manager: ContainerManager = {
        list: async () => (store.containers.length ? [details()] : []),
        inspect: async () => details(),
        logs: async () => [],
        action: async () => {
            throw new Error('Proxy must use shared controller');
        },
    };
    const reservation = http.createServer();
    const port = await listen(reservation);
    await new Promise<void>((resolve) => {
        reservation.close(() => resolve());
    });
    const proxy = startDaemonProxy({
        runtime: () =>
            ({ containers: () => manager }) as unknown as RuntimeStrategy,
        controller: () => f.controller,
        portOverride: port,
    });
    t.after(() => proxy.close());
    await proxy.listening;
    const held = await request(port);
    assert.equal(held.status, 503);
    assert.match(held.body, /api was manually stopped.*Start it explicitly/);
    assert.deepEqual(f.app.snapshot().live.stoppedByUser, ['api']);
    assert.equal(store.containers[0]!.lifecycle, 'exited');
    assert.equal(f.engine.applies, 1);
    await client.command('service.action', {
        action: 'start',
        services: ['api'],
    });
    assert.deepEqual(await request(port), {
        status: 200,
        body: 'allowed upstream',
    });
    assert.equal(hits, 1);
    await client.command('service.action', {
        action: 'stop',
        services: ['api'],
    });
    store.containers[0]!.lifecycle = 'running';
    await f.controller.probe();
    const warmHeld = await request(port);
    assert.equal(warmHeld.status, 503);
    assert.match(warmHeld.body, /manually stopped/);
    assert.equal(
        hits,
        1,
        'warm held traffic must never reach the listening upstream',
    );
    await client.command('environment.stop', {});
    assert.equal((await request(port)).status, 404);
    assert.equal(f.app.snapshot().live.running, false);
    assert.equal(store.containers.length, 0);
});
