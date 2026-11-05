import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRouteBuilder } from '../src/proxy/builder.js';
import { createAccounting } from '../src/proxy/accounting.js';
import type {
    ContainerDetails,
    ContainerManager,
    ContainerSummary,
} from '../src/domain/containers.js';

function container(
    id: string,
    service: string,
    state = 'Running',
): ContainerSummary {
    return {
        id,
        name: service,
        image: 'image',
        state,
        status: state,
        service,
        project: 'checkout',
    };
}

function details(
    service: string,
    labels: string[],
    address: string,
    ports: string[] = [],
): ContainerDetails {
    return {
        ...container(service, service),
        mounts: [],
        networks: [
            { name: 'bridge', addresses: ['172.20.0.9'] },
            { name: 'chs', addresses: [address] },
        ],
        inspection: {
            Config: {
                Labels: Object.fromEntries(
                    labels.map((label) => {
                        const index = label.indexOf('=');
                        return [label.slice(0, index), label.slice(index + 1)];
                    }),
                ),
            },
            NetworkSettings: {
                Ports: Object.fromEntries(
                    ports.map((port) => [`${port}/tcp`, null]),
                ),
            },
        },
    };
}

function stub(
    containers: ContainerSummary[],
    inspections: Record<string, ContainerDetails>,
) {
    let listed = 0;
    return {
        manager: {
            list: async () => {
                listed++;
                return containers;
            },
            inspect: async (id: string) => inspections[id]!,
            logs: async () => [],
            action: async () => {
                throw new Error('not used');
            },
        } as ContainerManager,
        listed: () => listed,
    };
}

const ROUTED = [
    'traefik.http.routers.accounts-filing-web.rule=Host(`find-and-file.company-information.service.chs.local`)',
    'traefik.http.services.accounts-filing-web.loadbalancer.server.port=3000',
];

test('routes come from running labeled containers on the chs network', async () => {
    const inspections = {
        web: details('accounts-filing-web', ROUTED, '172.21.0.10', ['9229']),
        unlabeled: details('mongo', [], '172.21.0.11'),
        proxy: details('ingress-proxy', ROUTED, '172.21.0.12'),
        mock: details('chs-dev-microcks', ROUTED, '172.21.0.13'),
    };
    const { manager } = stub(
        [
            container('web', 'accounts-filing-web'),
            container('unlabeled', 'mongo'),
            container('proxy', 'ingress-proxy'),
            container('mock', 'chs-dev-microcks'),
            container('stopped', 'company-profile-api', 'Exited'),
        ],
        inspections,
    );
    const builder = createRouteBuilder(manager);
    const resolved = await builder.current();
    assert.deepEqual(
        resolved.routes.map((route) => [route.service, route.port]),
        [['accounts-filing-web', 3000]],
    );
    assert.deepEqual(
        resolved.addresses.get('accounts-filing-web'),
        '172.21.0.10',
    );
});

test('the container set is cached until its fingerprint changes', async () => {
    const inspections = {
        web: details('accounts-filing-web', ROUTED, '172.21.0.10'),
    };
    const containers = [container('web', 'accounts-filing-web')];
    const fake = stub(containers, inspections);
    const builder = createRouteBuilder(fake.manager);
    await builder.current();
    await builder.current();
    assert.equal(fake.listed(), 2);
    assert.equal(Object.keys(inspections).filter(() => true).length, 1);
    containers.push(container('api', 'accounts-filing-api'));
    inspections.api = details(
        'accounts-filing-api',
        [
            'traefik.http.routers.accounts-filing-api.rule=Host(`api.chs.local`) && PathPrefix(`/accounts-filing-api`)',
            'traefik.http.services.accounts-filing-api.loadbalancer.server.port=8080',
        ],
        '172.21.0.14',
    );
    const rebuilt = await builder.current();
    assert.equal(rebuilt.routes.length, 2);
    assert.ok(
        rebuilt.routes.some((route) => route.service === 'accounts-filing-api'),
    );
});

test('a stopped routed container stops being routable', async () => {
    const inspections = {
        web: details('accounts-filing-web', ROUTED, '172.21.0.10'),
    };
    const containers = [container('web', 'accounts-filing-web', 'Exited')];
    const { manager } = stub(containers, inspections);
    const resolved = await createRouteBuilder(manager).current();
    assert.deepEqual(resolved.routes, []);
});

test('counters reset when a service starts, stops, or is recreated', async () => {
    const inspections = {
        'web-1': details('accounts-filing-web', ROUTED, '172.21.0.10'),
        'api-1': details(
            'accounts-filing-api',
            [
                'traefik.http.routers.accounts-filing-api.rule=Host(`api.chs.local`)',
            ],
            '172.21.0.14',
        ),
    };
    const containers = [
        container('web-1', 'accounts-filing-web'),
        container('api-1', 'accounts-filing-api'),
    ];
    const { manager } = stub(containers, inspections);
    const accounting = createAccounting();
    const builder = createRouteBuilder(manager, accounting);
    await builder.current();
    accounting.record('accounts-filing-web', '/a', []);
    accounting.record('accounts-filing-api', '/b', []);
    assert.deepEqual(accounting.snapshot().counts, {
        'accounts-filing-api': 1,
        'accounts-filing-web': 1,
    });

    containers.splice(1, 1);
    await builder.current();
    assert.deepEqual(accounting.snapshot().counts, {
        'accounts-filing-web': 1,
    });

    accounting.record('accounts-filing-web', '/c', []);
    containers[0]!.id = 'web-2';
    inspections['web-2'] = inspections['web-1']!;
    await builder.current();
    assert.deepEqual(accounting.snapshot(), { counts: {}, excluded: {} });
});
