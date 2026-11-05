import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
    ingressProxyRetired,
    ingressProxyService,
    withoutRetiredProxy,
    type InventoryEntry,
} from '../src/domain/live.js';
import { startDaemonProxy } from '../src/server/proxy-service.js';

const inventory = (services: string[]): InventoryEntry[] =>
    services.map((service) => ({ service, mode: 'Service' }));

test('the retired ingress proxy is filtered from the inventory', () => {
    const filtered = withoutRetiredProxy(
        inventory([ingressProxyService, 'api', 'web']),
        ingressProxyRetired,
    );
    assert.deepEqual(
        filtered.map((entry) => entry.service),
        ['api', 'web'],
    );
});

test('rollback keeps the ingress proxy when retirement is off', () => {
    const kept = withoutRetiredProxy(
        inventory([ingressProxyService, 'api']),
        false,
    );
    assert.deepEqual(
        kept.map((entry) => entry.service),
        [ingressProxyService, 'api'],
    );
});

test('the proxy takes over its port once the previous ingress leaves', async (t) => {
    const previous = http.createServer();
    const port = await new Promise<number>((resolve) => {
        previous.listen(0, '127.0.0.1', () => {
            const address = previous.address() as { port: number };
            resolve(address.port);
        });
    });
    t.after(async () => {
        await proxy.close();
        await new Promise<void>((resolve) => {
            previous.close(resolve);
        });
    });

    const proxy = startDaemonProxy({ bindRetryMs: 20, portOverride: port });
    const acquired = await Promise.race([
        proxy.listening.then(() => true),
        delay(2000).then(() => false),
    ]);
    assert.equal(acquired, true);
});
