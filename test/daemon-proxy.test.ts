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
import { daemonFixture } from './daemon-fixture.js';

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
    await f.controller.poll();
    const upstream = http.createServer((_request, response) =>
        response.end('applied api'),
    );
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
    assert.deepEqual(await request(port), { status: 200, body: 'applied api' });
    assert.deepEqual(proxy.state().lazy, ['api']);
});
