import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Mapping } from '../src/project/compose.js';
import { nodeProjectFs } from '../src/project/files.js';
import { measureProject, measureSelection } from '../src/project/measure.js';
import {
    readState,
    resolveServices,
    type Definitions,
    type ServiceDefinition,
} from '../src/project/resolve.js';

function definition(
    spec: Record<string, unknown>,
    base = false,
): ServiceDefinition {
    return {
        spec: spec as Mapping,
        source: 'test',
        module: 'm',
        base,
        labels: {},
        mock: base ? undefined : { defaultScenario: 'default', scenarios: [] },
    };
}

function definitions(entries: Record<string, ServiceDefinition>) {
    return new Map(Object.entries(entries));
}

function fixture(): Definitions {
    return definitions({
        redis: definition({ image: 'redis', mem_limit: '512m' }, true),
        api: definition({
            image: 'api',
            mem_limit: '1g',
            mem_reservation: '256m',
            depends_on: ['redis', 'worker'],
        }),
        worker: definition({ image: 'worker', depends_on: ['redis'] }),
        mocked: definition({ image: 'heavy' }),
    });
}

const state = readState(
    'services: [api, worker, mocked]\nserviceProviders:\n  mocked: mock\n',
);

test('measurement counts services, modes, and in-selection dependency edges', () => {
    const first = measureSelection(fixture(), state);
    const second = measureSelection(fixture(), state);
    assert.deepEqual(first, second);
    assert.equal(first.serviceCount, 4);
    assert.equal(first.baseServiceCount, 1);
    assert.deepEqual(first.baseServices, ['redis']);
    assert.deepEqual(first.services, ['api', 'mocked', 'redis', 'worker']);
    assert.equal(first.dependencyEdgeCount, 3);
    assert.deepEqual(first.modeCounts, { Service: 3, Mock: 1 });
});

test('edges to excluded services are not counted', () => {
    const excluded = readState(
        'services: [api, mocked]\nexcludedServices: [worker]\nserviceProviders:\n  mocked: mock\n',
    );
    const measurement = measureSelection(fixture(), excluded);
    assert.deepEqual(measurement.services, ['api', 'mocked', 'redis']);
    assert.equal(measurement.dependencyEdgeCount, 1);
});

test('declared memory is summed per field and gaps are reported', () => {
    const measurement = measureSelection(fixture(), state);
    assert.equal(measurement.memoryLimitBytes, 512 * 1024 ** 2 + 1024 ** 3);
    assert.equal(measurement.memoryReservationBytes, 256 * 1024 ** 2);
    assert.equal(measurement.servicesWithMemoryLimit, 2);
    assert.deepEqual(measurement.servicesWithoutMemoryLimit, [
        'mocked',
        'worker',
    ]);
    assert.deepEqual(measurement.unparsedMemory, []);
});

test('unparseable memory values are listed without dropping the rest', () => {
    const broken = definitions({
        redis: definition({ image: 'redis', mem_limit: 'lots' }, true),
        api: definition({ image: 'api', mem_limit: '1g' }),
    });
    const measurement = measureSelection(
        broken,
        readState('services: [api]\n'),
    );
    assert.equal(measurement.memoryLimitBytes, 1024 ** 3);
    assert.deepEqual(measurement.unparsedMemory, [
        { service: 'redis', field: 'mem_limit', value: 'lots' },
    ]);
});

test('resolveServices is unchanged by the measurement refactor', () => {
    const inventory = resolveServices(fixture(), state);
    assert.deepEqual(
        inventory.map((entry) => [entry.service, entry.mode]),
        [
            ['api', 'Service'],
            ['mocked', 'Mock'],
            ['redis', 'Service'],
            ['worker', 'Service'],
            ['chs-dev-microcks', 'Mock'],
        ],
    );
});

test('measureProject reads a checkout: definitions plus .chs-dev.yaml', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-measure-'));
    try {
        await mkdir(join(directory, 'services/modules/m'), {
            recursive: true,
        });
        await mkdir(join(directory, 'services/infrastructure'), {
            recursive: true,
        });
        await writeFile(
            join(directory, 'services/modules/m/app.docker-compose.yaml'),
            'services:\n  api:\n    image: api\n    mem_limit: 1g\n    depends_on: [db]\n  db:\n    image: db\n    mem_limit: 256m\n',
        );
        await writeFile(join(directory, '.chs-dev.yaml'), 'services: [api]\n');
        const measurement = await measureProject(directory, nodeProjectFs);
        assert.equal(measurement.journey, undefined);
        assert.equal(measurement.baseline.serviceCount, 2);
        assert.deepEqual(measurement.baseline.services, ['api', 'db']);
        assert.equal(measurement.baseline.dependencyEdgeCount, 1);
        assert.equal(
            measurement.baseline.memoryLimitBytes,
            1024 ** 3 + 256 * 1024 ** 2,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
