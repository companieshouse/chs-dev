import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    resolveServiceState,
    resolveStateInventory,
} from '../src/domain/service-state.js';
import {
    serviceMode,
    type ServiceDefinition,
    type ServiceGroup,
} from '../src/domain/services.js';

function catalogue(
    definitions: Record<string, Partial<ServiceDefinition>>,
): ServiceGroup[] {
    return [
        {
            name: 'app',
            services: Object.keys(definitions),
            definitions: Object.fromEntries(
                Object.entries(definitions).map(([name, definition]) => [
                    name,
                    {
                        module: 'app',
                        dependencies: [],
                        base: false,
                        deprecated: false,
                        ...definition,
                    },
                ]),
            ),
        },
    ];
}

test('configuration rules run without IO and leave their inputs untouched', () => {
    const groups: ServiceGroup[] = [
        {
            name: 'api',
            services: ['api'],
            definitions: {
                api: {
                    module: 'api',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                },
            },
        },
    ];
    const state = Object.freeze({
        modules: Object.freeze(['api']),
        servicesWithLiveUpdate: Object.freeze(['api']),
    });
    assert.deepEqual(resolveServiceState(state, groups), {
        api: {
            enabled: 'Yes',
            mode: 'Development',
            effectiveStartMode: 'always',
            startModeSource: 'manual',
        },
    });
    assert.equal(serviceMode('sockpuppet', false), 'Mock');
    assert.equal(serviceMode('sockpuppet', true), 'Development');
    assert.throws(
        () => resolveServiceState({ modules: 'api' }, groups),
        /Invalid modules/,
    );
    assert.throws(
        () => resolveServiceState(null, groups),
        /Expected a state mapping/,
    );
});

test('configuration state must be a mapping rather than a list or scalar', () => {
    for (const value of [[], ['api'], true, 42, 'api'])
        assert.throws(
            () => resolveServiceState(value, catalogue({ api: {} })),
            /Expected a state mapping/,
        );
});

test('enabled closure combines modules, explicit services and base services while respecting exclusions', () => {
    const groups = catalogue({
        web: {
            module: 'frontend',
            dependencies: ['api', 'excluded', 'file-excluded', 'legacy'],
        },
        api: { dependencies: ['db'] },
        db: { dependencies: ['api'] },
        worker: {},
        proxy: { base: true },
        excluded: {},
        'file-excluded': {},
        legacy: { deprecated: true },
        off: {},
    });
    const state = {
        modules: ['frontend'],
        services: ['worker'],
        excludedServices: ['excluded'],
        excludedFiles: ['file-excluded'],
    };
    const details = resolveServiceState(state, groups);
    assert.deepEqual(
        Object.keys(details).filter((name) => details[name].enabled === 'Yes'),
        ['web', 'api', 'db', 'worker', 'proxy'],
    );
    for (const name of ['excluded', 'file-excluded'])
        assert.deepEqual(details[name], {
            enabled: 'No',
            mode: 'Service',
            excluded: true,
        });
    assert.deepEqual(details.legacy, { enabled: 'No', mode: 'Service' });
    assert.equal(details.proxy.startModeSource, 'manual');
    assert.equal(details.worker.startModeSource, 'manual');
    assert.equal(details.api.startModeSource, 'default');
    assert.deepEqual(resolveStateInventory(state, groups), [
        { service: 'web', mode: 'Service' },
        { service: 'api', mode: 'Service', reclaimable: true },
        { service: 'db', mode: 'Service', reclaimable: true },
        { service: 'worker', mode: 'Service' },
        { service: 'proxy', mode: 'Service' },
    ]);
});

const mock = {
    defaultScenario: 'ok',
    scenarios: [
        { name: 'ok', description: 'Successful response' },
        { name: 'error', description: 'Failed response' },
    ],
};

test('mock providers omit their dependency subtree and retain active or saved scenarios', () => {
    const groups = catalogue({
        web: { dependencies: ['api'] },
        api: { dependencies: ['db'], mock },
        db: {},
    });
    const state = {
        services: ['web'],
        serviceProviders: { api: 'mock' },
        mockScenarios: { api: 'error' },
    };
    const details = resolveServiceState(state, groups);
    assert.deepEqual(details.api, {
        enabled: 'Yes',
        mode: 'Mock',
        effectiveStartMode: 'always',
        startModeSource: 'default',
        mockScenario: 'error',
    });
    assert.equal(details.db.enabled, 'No');
    assert.deepEqual(resolveStateInventory(state, groups), [
        { service: 'web', mode: 'Service' },
        { service: 'api', mode: 'Mock', mockScenario: 'error' },
    ]);
    const saved = resolveServiceState(
        { ...state, serviceProviders: { api: 'service' } },
        groups,
    );
    assert.equal(saved.api.savedMockScenario, 'error');
    assert.equal(saved.api.mockScenario, undefined);
    assert.equal(saved.db.enabled, 'Yes');
    assert.equal(serviceMode('sockpuppet', true, 'service'), 'Service');
    assert.equal(serviceMode('api', false, 'development'), 'Development');
    assert.equal(serviceMode('api', false, 'mock'), 'Mock');
    assert.equal(serviceMode('api', false), 'Service');
});

test('start-mode details and inventory preserve labels, eager overrides, inheritance and learned laziness', () => {
    const groups = catalogue({
        web: { dependencies: ['lazy', 'eager', 'learned', 'forced'] },
        lazy: { startMode: 'lazy', dependencies: ['inherited'] },
        eager: { startMode: 'always' },
        learned: {},
        forced: { startMode: 'lazy' },
        inherited: {},
    });
    const state = {
        services: ['web'],
        serviceStartModes: { forced: 'always' },
    };
    const details = resolveServiceState(state, groups);
    assert.deepEqual(details.lazy, {
        enabled: 'Yes',
        mode: 'Service',
        startModeLabel: 'lazy',
        effectiveStartMode: 'lazy',
        startModeSource: 'label',
    });
    assert.deepEqual(details.forced, {
        enabled: 'Yes',
        mode: 'Service',
        startModeOverride: 'always',
        startModeLabel: 'lazy',
        effectiveStartMode: 'always',
        startModeSource: 'override',
    });
    assert.equal(details.eager.startModeSource, 'label');
    assert.equal(details.inherited.startModeSource, 'inherited');
    assert.deepEqual(
        resolveStateInventory(state, groups, new Set(['learned'])),
        [
            { service: 'web', mode: 'Service' },
            {
                service: 'lazy',
                mode: 'Service',
                lazy: true,
                startModeSource: 'label',
            },
            { service: 'eager', mode: 'Service' },
            {
                service: 'learned',
                mode: 'Service',
                lazy: true,
                lazySource: 'learned',
                startModeSource: 'learned',
                reclaimable: true,
            },
            { service: 'forced', mode: 'Service' },
            {
                service: 'inherited',
                mode: 'Service',
                lazy: true,
                startModeSource: 'inherited',
                reclaimable: true,
            },
        ],
    );
});

test('a mock consumer does not prevent a shared dependency inheriting laziness from its real consumer', () => {
    const groups = catalogue({
        web: { dependencies: ['mock-api', 'lazy-api'] },
        'mock-api': { dependencies: ['shared'], mock },
        'lazy-api': { dependencies: ['shared'], startMode: 'lazy' },
        shared: {},
    });
    const inventory = resolveStateInventory(
        { services: ['web'], serviceProviders: { 'mock-api': 'mock' } },
        groups,
    );
    assert.deepEqual(
        inventory.find((entry) => entry.service === 'shared'),
        {
            service: 'shared',
            mode: 'Service',
            lazy: true,
            startModeSource: 'inherited',
            reclaimable: true,
        },
    );
});

test('image details distinguish environment versions, compose defaults and explicit pins', () => {
    const groups = catalogue({
        api: {
            image: '123456789012.dkr.ecr.eu-west-2.amazonaws.com/api:latest',
        },
        plain: { image: 'redis:7' },
    });
    const details = resolveServiceState(
        {
            versionSource: 'staging',
            serviceVersionSources: { plain: 'latest' },
            serviceImages: { api: 'example/api:1.2.3' },
        },
        groups,
    );
    assert.deepEqual(details.api, {
        enabled: 'No',
        mode: 'Service',
        versionSource: 'staging',
        defaultVersionSource: 'staging',
        environmentVersionsAvailable: true,
        versionSourceOverride: undefined,
        image: 'example/api:1.2.3',
        imagePinned: true,
    });
    assert.deepEqual(details.plain, {
        enabled: 'No',
        mode: 'Service',
        versionSource: 'latest',
        defaultVersionSource: 'compose',
        environmentVersionsAvailable: false,
        versionSourceOverride: 'latest',
    });
});
