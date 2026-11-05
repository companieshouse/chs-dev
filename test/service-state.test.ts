import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readServiceState } from '../src/project/service-state.js';
import { resolveStateInventory } from '../src/domain/service-state.js';
import type { ServiceGroup } from '../src/project/catalog.js';

test('resolves enabled modules and dependencies, exclusions, development and dedicated mocks', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-state-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const definition = (
        module: string,
        dependencies: string[] = [],
        base = false,
    ) => ({ module, dependencies, base, deprecated: false });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: [
                'web',
                'api',
                'db',
                'excluded',
                'ch-service-mock',
                'proxy',
                'old',
            ],
            definitions: {
                web: definition('app', ['api', 'excluded']),
                api: definition('backend', ['db']),
                db: definition('infra', ['api']),
                excluded: definition('app'),
                'ch-service-mock': definition('mocks'),
                proxy: definition('infrastructure', [], true),
                old: { ...definition('app'), deprecated: true },
            },
        },
    ];
    const defaults = await readServiceState(directory, groups);
    assert.equal(defaults.web?.enabled, 'No');
    assert.equal(defaults.proxy?.enabled, 'Yes');
    await writeFile(
        join(directory, '.chs-dev.yaml'),
        'modules: [app]\nservices: [ch-service-mock]\nservicesWithLiveUpdate: [api]\nexcludedServices: [excluded]\n',
    );
    const details = await readServiceState(directory, groups);
    assert.equal(details.web?.enabled, 'Yes');
    assert.deepEqual(details.api, {
        enabled: 'Yes',
        mode: 'Development',
        effectiveStartMode: 'always',
        startModeSource: 'default',
    });
    assert.equal(details.db?.enabled, 'Yes');
    assert.equal(details.excluded?.enabled, 'No');
    assert.equal(details.old?.enabled, 'No');
    assert.deepEqual(details['ch-service-mock'], {
        enabled: 'Yes',
        mode: 'Mock',
        effectiveStartMode: 'always',
        startModeSource: 'manual',
    });
    await writeFile(join(directory, '.chs-dev.yaml'), 'services: invalid');
    await assert.rejects(
        readServiceState(directory, groups),
        /Invalid services/,
    );
});

test('state inventory entries carry the shared lazy and reclaimable flags', () => {
    const definition = (
        module: string,
        dependencies: string[] = [],
        base = false,
        startMode?: 'lazy' | 'always',
    ) => ({ module, dependencies, base, deprecated: false, startMode });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['web', 'api', 'lazy-dep', 'proxy', 'mocksvc'],
            definitions: {
                web: definition('app', ['api', 'lazy-dep']),
                api: definition('backend'),
                'lazy-dep': definition('backend', [], false, 'lazy'),
                proxy: definition('infrastructure', [], true),
                mocksvc: {
                    ...definition('mocks'),
                    mock: { defaultScenario: 'ok', scenarios: ['ok'] },
                },
            },
        },
    ];
    const inventory = resolveStateInventory(
        { services: ['web', 'mocksvc'], serviceProviders: { mocksvc: 'mock' } },
        groups,
    );
    assert.deepEqual(inventory, [
        { service: 'web', mode: 'Service' },
        { service: 'api', mode: 'Service', reclaimable: true },
        {
            service: 'lazy-dep',
            mode: 'Service',
            lazy: true,
            startModeSource: 'label',
        },
        { service: 'proxy', mode: 'Service' },
        { service: 'mocksvc', mode: 'Mock', mockScenario: 'ok' },
    ]);
});

test('state inventory inherits lazy through a lazy parent and honours overrides', () => {
    const definition = (
        dependencies: string[] = [],
        startMode?: 'lazy' | 'always',
    ) => ({
        module: 'app',
        dependencies,
        base: false,
        deprecated: false,
        startMode,
    });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['a', 'b', 'c'],
            definitions: {
                a: definition(['b']),
                b: definition(['c'], 'lazy'),
                c: definition(),
            },
        },
    ];
    const inherited = resolveStateInventory({ services: ['a'] }, groups);
    assert.equal(
        inherited.find((entry) => entry.service === 'c')?.startModeSource,
        'inherited',
    );
    const overridden = resolveStateInventory(
        { services: ['a'], serviceStartModes: { a: 'lazy' } },
        groups,
    );
    assert.equal(
        overridden.find((entry) => entry.service === 'a')?.startModeSource,
        'override',
    );
});
