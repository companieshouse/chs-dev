import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    appliedServicePolicy,
    effectiveStartModes,
    filterSshRequirements,
    inventoryFlags,
    LifecycleBlocked,
    mockOnlyInventory,
    withoutRetiredProxy,
    withMockRuntime,
    type InventoryEntry,
    type SshSecretRequirement,
    type StartModeCandidate,
} from '../src/domain/live.js';

test('applied lifecycle metadata accepts versioned policies and rejects malformed field values', () => {
    const policy = {
        version: 1,
        lazy: false,
        reclaimable: true,
        dependencies: ['db'],
    };
    assert.deepEqual(
        appliedServicePolicy(JSON.stringify(policy), 'api'),
        policy,
    );
    assert.deepEqual(
        appliedServicePolicy(
            '{"version":1,"lazy":true,"reclaimable":false,"dependencies":[]}',
            'api',
        ),
        { version: 1, lazy: true, reclaimable: false, dependencies: [] },
    );
    const invalid = [
        undefined,
        policy,
        [JSON.stringify(policy)],
        '{',
        'null',
        JSON.stringify({ ...policy, version: 2 }),
        JSON.stringify({ ...policy, lazy: 'false' }),
        JSON.stringify({ ...policy, reclaimable: 0 }),
        JSON.stringify({ ...policy, dependencies: {} }),
        JSON.stringify({ ...policy, dependencies: [''] }),
        JSON.stringify({ ...policy, dependencies: [42] }),
    ];
    for (const value of invalid)
        assert.throws(
            () => appliedServicePolicy(value, 'api'),
            LifecycleBlocked,
        );
});

test('retired ingress is removed by default and remains available when retirement is disabled', () => {
    const inventory: InventoryEntry[] = [
        { service: 'ingress-proxy', mode: 'Service' },
        { service: 'api', mode: 'Service' },
    ];
    assert.deepEqual(withoutRetiredProxy(inventory), [
        { service: 'api', mode: 'Service' },
    ]);
    assert.deepEqual(withoutRetiredProxy(inventory, false), [
        { service: 'ingress-proxy', mode: 'Service' },
        { service: 'api', mode: 'Service' },
    ]);
});

test('mock scenarios add their shared runtime and mock-only detection requires an actual scenario', () => {
    const mockInventory: InventoryEntry[] = [
        { service: 'api', mode: 'Mock', mockScenario: 'ok' },
    ];
    assert.deepEqual(withMockRuntime(mockInventory), [
        { service: 'api', mode: 'Mock', mockScenario: 'ok' },
        { service: 'chs-dev-microcks', mode: 'Mock' },
    ]);
    assert.equal(
        mockOnlyInventory([
            ...mockInventory,
            { service: 'chs-dev-microcks', mode: 'Mock' },
            { service: 'ingress-proxy', mode: 'Service' },
        ]),
        true,
    );
    assert.equal(mockOnlyInventory([]), false);
    assert.equal(
        mockOnlyInventory([{ service: 'chs-dev-microcks', mode: 'Mock' }]),
        false,
    );
    assert.equal(
        mockOnlyInventory([
            ...mockInventory,
            { service: 'db', mode: 'Service' },
        ]),
        false,
    );
});

test('SSH requirements retain non-excluded services and remove requirements with no services left', () => {
    const requirements: SshSecretRequirement[] = [
        {
            kind: 'container-ssh-secrets',
            services: ['api', 'worker'],
            keyPath: '/keys/container',
            passphrasePath: '/keys/container-passphrase',
        },
        {
            kind: 'container-ssh-secrets',
            services: ['worker'],
            keyPath: '/keys/worker',
            passphrasePath: '/keys/worker-passphrase',
        },
        {
            kind: 'docker-ssh-secrets',
            services: ['db'],
            keyPath: '/keys/docker',
            passphrasePath: '/keys/docker-passphrase',
        },
    ];
    assert.deepEqual(filterSshRequirements(requirements, new Set(['worker'])), [
        {
            kind: 'container-ssh-secrets',
            services: ['api'],
            keyPath: '/keys/container',
            passphrasePath: '/keys/container-passphrase',
        },
        {
            kind: 'docker-ssh-secrets',
            services: ['db'],
            keyPath: '/keys/docker',
            passphrasePath: '/keys/docker-passphrase',
        },
    ]);
    assert.deepEqual(requirements[0]?.services, ['api', 'worker']);
});

function candidate(
    service: string,
    selections: Partial<StartModeCandidate> = {},
): StartModeCandidate {
    return {
        service,
        pinned: false,
        base: false,
        development: false,
        mock: false,
        explicitLazy: false,
        learned: false,
        ...selections,
    };
}

test('effective start modes keep base and development eager and apply overrides before journey and manual choices', () => {
    const modes = effectiveStartModes(
        [
            candidate('base', { pinned: true, base: true, override: 'lazy' }),
            candidate('development', {
                pinned: true,
                development: true,
                override: 'lazy',
            }),
            candidate('override', {
                pinned: true,
                override: 'lazy',
                label: 'always',
            }),
            candidate('eager-override', {
                override: 'always',
                explicitLazy: true,
                label: 'lazy',
            }),
            candidate('journey', {
                pinned: true,
                explicitLazy: true,
                label: 'always',
            }),
            candidate('manual', { pinned: true, label: 'lazy', learned: true }),
            candidate('label', { label: 'lazy' }),
            candidate('learned', { learned: true }),
            candidate('mock', { mock: true }),
            candidate('ordinary'),
        ],
        new Map(),
    );
    assert.deepEqual(Object.fromEntries(modes), {
        base: {},
        development: {},
        override: { lazy: true, startModeSource: 'override' },
        'eager-override': {},
        journey: { lazy: true, startModeSource: 'journey' },
        manual: {},
        label: { lazy: true, startModeSource: 'label' },
        learned: {
            lazy: true,
            lazySource: 'learned',
            startModeSource: 'learned',
            reclaimable: true,
        },
        mock: {},
        ordinary: { reclaimable: true },
    });
});

test('lazy inheritance reaches descendants in any catalogue order and requires every enabled parent to be lazy', () => {
    const modes = effectiveStartModes(
        [
            candidate('leaf'),
            candidate('middle'),
            candidate('shared'),
            candidate('labelled-child', { label: 'always' }),
            candidate('orphan'),
            candidate('cycle-a'),
            candidate('cycle-b'),
            candidate('lazy-parent', { label: 'lazy' }),
            candidate('other-lazy-parent', { label: 'lazy' }),
            candidate('eager-parent', { pinned: true }),
        ],
        new Map([
            [
                'lazy-parent',
                ['middle', 'shared', 'labelled-child', 'outside-selection'],
            ],
            ['other-lazy-parent', ['labelled-child']],
            ['eager-parent', ['shared']],
            ['middle', ['leaf']],
            ['cycle-a', ['cycle-b']],
            ['cycle-b', ['cycle-a']],
        ]),
    );
    assert.deepEqual(Object.fromEntries(modes), {
        leaf: { lazy: true, startModeSource: 'inherited', reclaimable: true },
        middle: { lazy: true, startModeSource: 'inherited', reclaimable: true },
        shared: { reclaimable: true },
        'labelled-child': { lazy: true, startModeSource: 'inherited' },
        orphan: { reclaimable: true },
        'cycle-a': { reclaimable: true },
        'cycle-b': { reclaimable: true },
        'lazy-parent': { lazy: true, startModeSource: 'label' },
        'other-lazy-parent': { lazy: true, startModeSource: 'label' },
        'eager-parent': {},
    });
});

test('inventory flags distinguish derived, learned, labelled, pinned, mock and explicit lazy services', () => {
    const ordinary = {
        pinned: false,
        labelled: false,
        lazyLabel: false,
        mock: false,
        explicitLazy: false,
        learned: false,
    };
    assert.deepEqual(inventoryFlags(ordinary), { reclaimable: true });
    assert.deepEqual(inventoryFlags({ ...ordinary, learned: true }), {
        lazy: true,
        lazySource: 'learned',
        reclaimable: true,
    });
    assert.deepEqual(
        inventoryFlags({ ...ordinary, pinned: true, learned: true }),
        {},
    );
    assert.deepEqual(
        inventoryFlags({ ...ordinary, labelled: true, learned: true }),
        {},
    );
    assert.deepEqual(
        inventoryFlags({ ...ordinary, explicitLazy: true, learned: true }),
        { lazy: true, reclaimable: true },
    );
    assert.deepEqual(
        inventoryFlags({ ...ordinary, labelled: true, lazyLabel: true }),
        { lazy: true },
    );
    assert.deepEqual(
        inventoryFlags({
            ...ordinary,
            pinned: true,
            labelled: true,
            lazyLabel: true,
        }),
        {},
    );
    assert.deepEqual(inventoryFlags({ ...ordinary, mock: true }), {});
    assert.deepEqual(
        inventoryFlags({ ...ordinary, pinned: true, explicitLazy: true }),
        { lazy: true },
    );
});
