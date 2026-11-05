import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { mockProviderSpec } from '../src/project/mock-provider.js';
import { nodeProjectFs } from '../src/project/files.js';
import { readMockCatalogue } from '../src/project/mock-catalogue.js';
import type { ServiceDefinition } from '../src/project/resolve.js';
import type { InventoryEntry } from '../src/domain/live.js';
import { createRouteBuilder } from '../src/proxy/builder.js';
import { createAccounting } from '../src/proxy/accounting.js';
import type {
    ContainerDetails,
    ContainerManager,
    ContainerSummary,
} from '../src/domain/containers.js';

const item = (service: string, scenario: string): InventoryEntry => ({
    service,
    mode: 'Mock',
    mockScenario: scenario,
});

const definition = (): ServiceDefinition => ({
    spec: {
        image: 'real-image',
        labels: [
            'traefik.http.routers.felixvalidator.rule=Host(`api.chs.local`) && PathPrefix(`/xbrl-validate`)',
            'traefik.http.services.felixvalidator.loadbalancer.server.port=8080',
            'chs.description=Felix XBRL validation',
        ],
    },
    source: '/project/services/modules/felix/felix.docker-compose.yaml',
    module: 'felix',
    base: false,
    labels: {},
});

test('a mocked service keeps its route and declares its health paths', async (t) => {
    const output = await mkdtemp(join(tmpdir(), 'chs-mock-route-'));
    t.after(() => rm(output, { recursive: true, force: true }));
    const catalogue = await readMockCatalogue();
    const contract = catalogue.services.felixvalidator!;
    const spec = await mockProviderSpec(
        item('felixvalidator', 'success'),
        definition(),
        output,
        nodeProjectFs,
    );
    const generated = spec as unknown as {
        labels: Record<string, string>;
    };
    assert.match(
        generated.labels['traefik.http.routers.felixvalidator.rule'] ?? '',
        /Host\(`api\.chs\.local`\)/,
    );
    assert.equal(
        generated.labels['chs.dev.mock.health-paths'],
        contract.healthPaths.join(','),
    );
    assert.equal(generated.image, 'node:22.20.0-alpine');
});

test('the proxy honours a mock container’s declared health paths', async () => {
    const labels = [
        'traefik.http.routers.felixvalidator.rule=Host(`api.chs.local`) && PathPrefix(`/xbrl-validate`)',
        'traefik.http.services.felixvalidator.loadbalancer.server.port=8080',
        'chs.dev.mock.health-paths=/xbrl-validate/health,/ready',
    ];
    const inspection = {
        Config: {
            Labels: Object.fromEntries(
                labels.map((label) => {
                    const index = label.indexOf('=');
                    return [label.slice(0, index), label.slice(index + 1)];
                }),
            ),
        },
        NetworkSettings: {
            Ports: { '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '40808' }] },
        },
    };
    const summary: ContainerSummary = {
        id: 'mock-1',
        name: 'felixvalidator',
        image: 'node',
        state: 'running',
        status: 'running',
        service: 'felixvalidator',
        project: 'checkout',
    };
    const details: ContainerDetails = {
        ...summary,
        mounts: [],
        networks: [{ name: 'chs', addresses: ['172.21.0.20'] }],
        inspection,
    };
    const manager: ContainerManager = {
        list: async () => [summary],
        inspect: async (id) => details,
        logs: async () => [],
        action: async () => {
            throw new Error('not used');
        },
    };
    const accounting = createAccounting();
    const { routes } = await createRouteBuilder(manager, accounting).current();
    const matched = routes.find((candidate) =>
        candidate.matches('api.chs.local', '/xbrl-validate'),
    );
    assert.equal(matched?.service, 'felixvalidator');
    assert.deepEqual(matched?.healthcheckPaths, [
        '/ready',
        '/xbrl-validate/health',
    ]);
    assert.equal(matched?.port, 8080);

    accounting.record(
        'felixvalidator',
        '/xbrl-validate/health',
        matched!.healthcheckPaths,
    );
    accounting.record(
        'felixvalidator',
        '/xbrl-validate',
        matched!.healthcheckPaths,
    );
    assert.deepEqual(accounting.snapshot(), {
        counts: { felixvalidator: 1 },
        excluded: { felixvalidator: 1 },
    });
});

function stringify(value: unknown) {
    return JSON.stringify(value);
}
