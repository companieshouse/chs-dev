import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { resolveServiceState } from '../src/domain/service-state.js';
import {
    editSelections,
    projectSelections,
} from '../src/domain/configuration.js';
import type { ServiceGroup } from '../src/domain/services.js';
import { mockOnlyInventory, withMockRuntime } from '../src/domain/live.js';
import {
    readState,
    resolveServices,
    type Definitions,
} from '../src/project/resolve.js';
import { saveServiceChanges } from '../src/project/service-configuration.js';
import {
    configurationStore,
    liveFiles,
} from '../src/infrastructure/live-files.js';
import { readMockCatalogue } from '../src/project/mock-catalogue.js';
import { parseInvocation } from '../src/cli/parse.js';

function fixture() {
    const mock = {
        defaultScenario: 'success',
        scenarios: [
            { name: 'success', description: 'OK' },
            { name: 'error', description: 'Unavailable' },
        ],
    };
    const entries = {
        web: {
            dependencies: ['api'],
            module: 'web',
            base: false,
            deprecated: false,
        },
        api: {
            dependencies: ['database'],
            module: 'api',
            base: false,
            deprecated: false,
            development: true,
            mock,
        },
        database: {
            dependencies: ['cache'],
            module: 'infra',
            base: false,
            deprecated: false,
        },
        cache: {
            dependencies: ['database'],
            module: 'infra',
            base: false,
            deprecated: false,
        },
        'ingress-proxy': {
            dependencies: [],
            module: 'infra',
            base: true,
            deprecated: false,
        },
    };
    const groups: ServiceGroup[] = [
        {
            name: 'fixture',
            services: Object.keys(entries),
            definitions: entries,
        },
    ];
    const definitions: Definitions = new Map(
        Object.entries(entries).map(([name, definition]) => [
            name,
            {
                spec: { depends_on: definition.dependencies },
                source: '/fixture/compose.yaml',
                module: definition.module,
                base: definition.base,
                mock: 'mock' in definition ? definition.mock : undefined,
                labels:
                    'development' in definition
                        ? { 'chs.local.builder': 'node' }
                        : {},
            },
        ]),
    );
    return { groups, definitions };
}

test('mock providers stop dependency traversal in both UI and runtime resolution', () => {
    const { groups, definitions } = fixture();
    const state = {
        services: ['web'],
        serviceProviders: { api: 'mock' },
        mockScenarios: { api: 'error' },
    };
    const details = resolveServiceState(state, groups);
    assert.deepEqual(details.api, {
        enabled: 'Yes',
        mode: 'Mock',
        mockScenario: 'error',
    });
    assert.equal(details.database.enabled, 'No');
    assert.equal(details.cache.enabled, 'No');
    assert.deepEqual(
        resolveServices(definitions, readState(JSON.stringify(state))),
        [
            { service: 'api', mode: 'Mock', mockScenario: 'error' },
            { service: 'ingress-proxy', mode: 'Service' },
            { service: 'web', mode: 'Service' },
            { service: 'chs-dev-microcks', mode: 'Mock' },
        ],
    );
});

test('shared dependencies and explicit roots remain enabled while mocks omit their own subtree', () => {
    const { groups, definitions } = fixture();
    const state = {
        services: ['api', 'database'],
        serviceProviders: { api: 'mock' },
    };
    const details = resolveServiceState(state, groups);
    assert.equal(details.api.mockScenario, 'success');
    assert.equal(details.database.enabled, 'Yes');
    assert.equal(details.cache.enabled, 'Yes');
    assert.equal(
        resolveServices(definitions, readState(JSON.stringify(state))).length,
        5,
    );
    assert.equal(
        mockOnlyInventory(
            resolveServices(definitions, readState(JSON.stringify(state))),
        ),
        false,
    );
});

test('invalid providers, scenarios, unsupported mocks and infrastructure replacements fail before resolution', () => {
    const { groups, definitions } = fixture();
    for (const state of [
        { serviceProviders: { api: 'unknown' } },
        { serviceProviders: { missing: 'mock' } },
        { serviceProviders: { database: 'mock' } },
        { serviceProviders: { 'ingress-proxy': 'mock' } },
        {
            serviceProviders: { api: 'mock' },
            mockScenarios: { api: 'missing' },
        },
        { serviceProviders: [] },
        { mockScenarios: { api: 42 } },
    ]) {
        assert.throws(() => resolveServiceState(state, groups));
        assert.throws(() =>
            resolveServices(definitions, readState(JSON.stringify(state))),
        );
    }
});

test('saved provider and scenario changes preserve comments, avoid stale writes and agree with runtime inventory', async (t) => {
    const { groups } = fixture();
    const directory = await mkdtemp(join(tmpdir(), 'chs-provider-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, '.chs-dev.yaml');
    await writeFile(
        path,
        '# shared configuration\nservices: [web]\ncustom: keep\n',
    );
    const options = {
        directory,
        name: 'api',
        enabled: true,
        development: false,
        groups,
    };
    await saveServiceChanges({
        ...options,
        provider: 'mock',
        mockScenario: 'error',
    });
    const saved = await readFile(path, 'utf8');
    assert.match(saved, /# shared configuration/);
    assert.equal(parse(saved).custom, 'keep');
    const revision = await configurationStore(
        directory,
        groups,
        liveFiles,
    ).read();
    assert.equal(mockOnlyInventory(revision.inventory), false);
    assert.ok(
        revision.inventory.some(
            (entry) => entry.service === 'chs-dev-microcks',
        ),
    );
    assert.equal(
        revision.inventory.find((entry) => entry.service === 'api')
            ?.mockScenario,
        'error',
    );
    await assert.rejects(
        saveServiceChanges({
            ...options,
            provider: 'mock',
            mockScenario: 'missing',
        }),
    );
    assert.equal(await readFile(path, 'utf8'), saved);
    await assert.rejects(
        saveServiceChanges({
            ...options,
            provider: 'service',
            expectedRevision: 'stale',
        }),
        /changed/,
    );
    const details = await saveServiceChanges({
        ...options,
        provider: 'development',
        development: true,
    });
    assert.equal(details.database.enabled, 'Yes');
    assert.equal(details.api.mode, 'Development');
    assert.equal(details.api.savedMockScenario, 'error');
    assert.deepEqual(
        parse(await readFile(path, 'utf8')).servicesWithLiveUpdate,
        ['api'],
    );
    await saveServiceChanges({ ...options, provider: 'mock' });
    assert.equal(
        (
            await configurationStore(directory, groups, liveFiles).read()
        ).inventory.find((entry) => entry.service === 'api')?.mockScenario,
        'error',
    );
});

test('legacy development edits remain authoritative after an explicit provider choice', () => {
    const { groups } = fixture();
    const state = projectSelections({
        services: ['api'],
        serviceProviders: { api: 'mock' },
        mockScenarios: { api: 'error' },
    });
    const next = editSelections(
        state,
        { topic: 'development', action: 'enable', names: ['api'] },
        groups,
    );
    assert.equal(next.serviceProviders?.api, 'development');
    assert.equal(resolveServiceState(next, groups).api.mode, 'Development');
    assert.equal(state.serviceProviders?.api, 'mock');
});

test('mock-only inventories need no AWS, and removing the last mock removes the shared runtime', () => {
    const inventory = withMockRuntime([
        { service: 'api', mode: 'Mock', mockScenario: 'success' },
        { service: 'ingress-proxy', mode: 'Service' },
    ]);
    assert.equal(mockOnlyInventory(inventory), true);
    assert.equal(
        mockOnlyInventory([{ service: 'sockpuppet', mode: 'Mock' }]),
        false,
    );
    assert.deepEqual(withMockRuntime([{ service: 'api', mode: 'Service' }]), [
        { service: 'api', mode: 'Service' },
    ]);
});

test('CLI provider options reject conflicts locally and expose scenario discovery', () => {
    assert.equal(parseInvocation(['service', 'mocks']).name, 'service mocks');
    assert.equal(
        parseInvocation([
            'service',
            'configure',
            'api',
            '--provider',
            'mock',
            '--scenario',
            'error',
        ]).options.provider,
        'mock',
    );
    for (const args of [
        ['--provider', 'other'],
        ['--provider', 'mock', '--development', 'true'],
        ['--scenario', '../invalid'],
    ])
        assert.throws(() =>
            parseInvocation(['service', 'configure', 'api', ...args]),
        );
});

test('the repository catalogue supplies the starter contracts and Felix validation scenarios', async () => {
    const catalogue = await readMockCatalogue();
    assert.ok(catalogue.services['company-profile-api']);
    assert.ok(catalogue.services['transactions-api-ch-gov-uk']);
    assert.ok(catalogue.services['accounts-filing-api']);
    assert.ok(catalogue.services['company-accounts-api-ch-gov-uk']);
    const felix = catalogue.services.felixvalidator;
    assert.deepEqual(felix.ports, [8080]);
    assert.deepEqual(felix.healthPaths, ['/felixvalidator/healthcheck']);
    assert.equal(felix.asyncCallback?.requestPath, '/validate-async');
    assert.equal(felix.asyncCallback?.method, 'PATCH');
    for (const [name, contract] of Object.entries(catalogue.services))
        assert.deepEqual(
            contract.scenarios.map((scenario) => scenario.name),
            name === 'felixvalidator'
                ? ['success', 'validation-failed', 'error']
                : ['success', 'not-found', 'error'],
        );
});
