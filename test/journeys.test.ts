import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Mapping } from '../src/project/compose.js';
import { nodeProjectFs } from '../src/project/files.js';
import { loadJourney, selectedJourney } from '../src/project/journeys.js';
import { measureProject } from '../src/project/measure.js';
import {
    loadDefinitions,
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

function fixture(): Definitions {
    return new Map(
        Object.entries({
            redis: definition({ image: 'redis' }, true),
            api: definition({
                image: 'api',
                depends_on: ['redis', 'worker'],
            }),
            worker: definition({ image: 'worker', depends_on: ['redis'] }),
            mocked: definition({ image: 'heavy' }),
        }),
    );
}

async function checkout(files: Record<string, string>): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'chs-journeys-'));
    try {
        await mkdir(join(directory, 'services/modules/m'), {
            recursive: true,
        });
        await mkdir(join(directory, 'services/infrastructure'), {
            recursive: true,
        });
        await mkdir(join(directory, 'journeys'), { recursive: true });
        await writeFile(
            join(directory, 'services/modules/m/app.docker-compose.yaml'),
            'services:\n  api:\n    image: api\n    depends_on: [redis, worker]\n  worker:\n    image: worker\n    depends_on: [redis]\n',
        );
        await writeFile(
            join(directory, 'services/infrastructure/docker-compose.yaml'),
            'services:\n  redis:\n    image: redis\n',
        );
        for (const [name, content] of Object.entries(files)) {
            await writeFile(join(directory, name), content);
        }
        return directory;
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}

const pilot = {
    name: 'pilot',
    services: ['api'],
    lazy: ['worker'],
    excluded: [],
};

test('a journey resolves to the closure of the equivalent manual selection', () => {
    const provider = 'serviceProviders:\n  mocked: mock\n';
    const viaJourney = resolveServices(
        fixture(),
        readState(`services: [mocked]\n${provider}`),
        pilot,
    );
    const manual = resolveServices(
        fixture(),
        readState(`services: [api, worker, mocked]\n${provider}`),
    );
    assert.deepEqual(
        viaJourney.map((entry) => [entry.service, entry.mode]),
        manual.map((entry) => [entry.service, entry.mode]),
    );
    assert.deepEqual(
        viaJourney.map((entry) => entry.service),
        ['api', 'mocked', 'redis', 'worker', 'chs-dev-microcks'],
    );
});

test('journey lazy services are flagged on the resolution output', () => {
    const inventory = resolveServices(
        fixture(),
        readState('services: []\n'),
        pilot,
    );
    const byName = new Map(inventory.map((entry) => [entry.service, entry]));
    assert.equal(byName.get('worker')?.lazy, true);
    for (const name of ['api', 'redis']) {
        const entry = byName.get(name)!;
        assert.equal(entry.lazy, undefined);
        assert.ok(!('lazy' in entry));
    }
});

test('a lazy service keeps its mock scenario and runtime', () => {
    const inventory = resolveServices(
        fixture(),
        readState('serviceProviders:\n  mocked: mock\n'),
        { name: 'pilot', services: [], lazy: ['mocked'], excluded: [] },
    );
    const mocked = inventory.find((entry) => entry.service === 'mocked')!;
    assert.equal(mocked.lazy, true);
    assert.equal(mocked.mockScenario, 'default');
    assert.ok(inventory.some((entry) => entry.service === 'chs-dev-microcks'));
});

test('the no-journey path is unchanged: no lazy flags appear', () => {
    const inventory = resolveServices(
        fixture(),
        readState('services: [api, worker]\n'),
    );
    assert.ok(inventory.every((entry) => !('lazy' in entry)));
    assert.deepEqual(
        inventory.map((entry) => entry.service),
        ['api', 'redis', 'worker'],
    );
});

test('an unknown journey service is rejected naming the journey file', () => {
    assert.throws(
        () =>
            resolveServices(fixture(), readState('services: []\n'), {
                name: 'pilot',
                services: ['ghost'],
                lazy: [],
                excluded: [],
            }),
        /Journey file journeys\/pilot\.yaml references an unknown service: ghost/,
    );
});

test('a labelled dependency defaults to lazy without a journey', () => {
    const definitions = fixture();
    const worker = definitions.get('worker')!;
    worker.labels = { 'chs.start-mode': 'lazy' };
    const inventory = resolveServices(
        definitions,
        readState('services: [api]\n'),
    );
    const byName = new Map(inventory.map((entry) => [entry.service, entry]));
    assert.equal(byName.get('worker')?.lazy, true);
    assert.equal(byName.get('redis')?.lazy, undefined);
});

test('a directly selected labelled service starts anyway', () => {
    const definitions = fixture();
    const worker = definitions.get('worker')!;
    worker.labels = { 'chs.start-mode': 'lazy' };
    const inventory = resolveServices(
        definitions,
        readState('services: [api, worker]\n'),
    );
    const workerEntry = inventory.find((entry) => entry.service === 'worker')!;
    assert.equal(workerEntry.lazy, undefined);
});

function chainFixture(): Definitions {
    return new Map(
        Object.entries({
            redis: definition({ image: 'redis' }, true),
            a: definition({ image: 'a', depends_on: ['b'] }),
            b: definition({ image: 'b', depends_on: ['c'] }),
            c: definition({ image: 'c', depends_on: ['redis'] }),
        }),
    );
}

function lazyByName(inventory: ReturnType<typeof resolveServices>) {
    return new Map(
        inventory.map((entry) => [
            entry.service,
            entry.lazy ? entry.startModeSource : undefined,
        ]),
    );
}

test('an unlabelled dependency of a lazy service inherits lazy', () => {
    const definitions = chainFixture();
    definitions.get('b')!.labels = { 'chs.start-mode': 'lazy' };
    const modes = lazyByName(
        resolveServices(definitions, readState('services: [a]\n')),
    );
    assert.equal(modes.get('b'), 'label');
    assert.equal(modes.get('c'), 'inherited');
    assert.equal(modes.get('a'), undefined);
    assert.equal(modes.get('redis'), undefined);
});

test('a dependency shared with an eager parent does not inherit lazy', () => {
    const definitions = chainFixture();
    definitions.get('a')!.spec = {
        image: 'a',
        depends_on: ['b', 'c'],
    } as Mapping;
    definitions.get('b')!.labels = { 'chs.start-mode': 'lazy' };
    const modes = lazyByName(
        resolveServices(definitions, readState('services: [a]\n')),
    );
    assert.equal(modes.get('b'), 'label');
    assert.equal(modes.get('c'), undefined);
});

test('an always-labelled service in a lazy tree starts with its parent', () => {
    const definitions = chainFixture();
    definitions.get('b')!.labels = { 'chs.start-mode': 'lazy' };
    definitions.get('c')!.labels = { 'chs.start-mode': 'always' };
    const modes = lazyByName(
        resolveServices(definitions, readState('services: [a]\n')),
    );
    assert.equal(modes.get('c'), 'inherited');
});

test('a start-mode override makes a manually enabled service lazy', () => {
    const modes = lazyByName(
        resolveServices(
            fixture(),
            readState('services: [api]\nserviceStartModes:\n  api: lazy\n'),
        ),
    );
    assert.equal(modes.get('api'), 'override');
});

test('an always override beats a lazy label on a dependency', () => {
    const definitions = fixture();
    definitions.get('worker')!.labels = { 'chs.start-mode': 'lazy' };
    const modes = lazyByName(
        resolveServices(
            definitions,
            readState(
                'services: [api]\nserviceStartModes:\n  worker: always\n',
            ),
        ),
    );
    assert.equal(modes.get('worker'), undefined);
});

test('readState rejects an invalid start-mode override', () => {
    assert.throws(
        () => readState('serviceStartModes:\n  api: sometimes\n'),
        /Invalid serviceStartModes in .chs-dev.yaml/,
    );
});

test('a development-mode dependency never goes lazy', () => {
    const definitions = fixture();
    definitions.get('worker')!.labels = { 'chs.start-mode': 'lazy' };
    const inventory = resolveServices(
        definitions,
        readState('services: [api]\nservicesWithLiveUpdate: [worker]\n'),
    );
    const worker = inventory.find((entry) => entry.service === 'worker')!;
    assert.equal(worker.mode, 'Development');
    assert.equal(worker.lazy, undefined);
});

test('a journey exclusion removes a dependency from the closure', () => {
    const inventory = resolveServices(fixture(), readState('services: []\n'), {
        ...pilot,
        excluded: ['worker'],
    });
    assert.deepEqual(
        inventory.map((entry) => entry.service),
        ['api', 'redis'],
    );
});

test('excluding base infrastructure is rejected', () => {
    assert.throws(
        () =>
            resolveServices(fixture(), readState('services: []\n'), {
                ...pilot,
                excluded: ['redis'],
            }),
        /Base infrastructure cannot be excluded: redis/,
    );
});

test('loadDefinitions rejects an invalid start-mode value', async () => {
    const directory = await checkout({
        'services/modules/m/labelled.docker-compose.yaml':
            'services:\n  labelled:\n    image: labelled\n    labels:\n      chs.start-mode: eagerly\n',
    });
    try {
        await assert.rejects(
            () => loadDefinitions(directory, nodeProjectFs),
            /Invalid chs\.start-mode "eagerly" on service labelled: expected lazy or always/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('loadDefinitions rejects chs.start-mode on base infrastructure', async () => {
    const directory = await checkout({
        'services/infrastructure/docker-compose.yaml':
            'services:\n  redis:\n    image: redis\n  cache:\n    image: cache\n    labels:\n      chs.start-mode: lazy\n',
    });
    try {
        await assert.rejects(
            () => loadDefinitions(directory, nodeProjectFs),
            /chs\.start-mode is not supported on base infrastructure: cache/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('readState carries the journey selection', () => {
    assert.equal(readState('services: []\njourney: pilot\n').journey, 'pilot');
    assert.throws(
        () => readState('journey: [pilot]\n'),
        /Configuration has invalid journey/,
    );
});

test('loadJourney reads a journey file', async () => {
    const directory = await checkout({
        'journeys/pilot.yaml': 'services: [api]\nlazy: [worker]\n',
    });
    try {
        assert.deepEqual(await loadJourney(directory, 'pilot', nodeProjectFs), {
            name: 'pilot',
            services: ['api'],
            lazy: ['worker'],
            excluded: [],
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('loadJourney deduplicates list entries', async () => {
    const directory = await checkout({
        'journeys/pilot.yaml': 'services: [api, api]\nlazy: []\n',
    });
    try {
        const journey = await loadJourney(directory, 'pilot', nodeProjectFs);
        assert.deepEqual(journey.services, ['api']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('loadJourney rejects a missing file and an invalid name', async () => {
    const directory = await checkout({});
    try {
        await assert.rejects(
            () => loadJourney(directory, 'ghost', nodeProjectFs),
            /Journey file journeys\/ghost\.yaml does not exist/,
        );
        await assert.rejects(
            () => loadJourney(directory, '../evil', nodeProjectFs),
            /Invalid journey name: \.\.\/evil/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('malformed journey files fail naming the file and the offending key', async () => {
    const cases: Array<[string, RegExp]> = [
        ['services: [api', /is not valid YAML/],
        ['- api\n', /must be a mapping/],
        ['', /must be a mapping/],
        ['servcies: [api]\n', /has unknown key: servcies/],
        ['extra: true\nservices: [api]\n', /has unknown key: extra/],
        ['services: api\n', /has invalid services/],
        ['services: [api, 3]\n', /has invalid services/],
        ['lazy: worker\n', /has invalid lazy/],
        [
            'services: [api]\nlazy: [api]\n',
            /lists api in both services and lazy/,
        ],
        ['services: []\nlazy: []\n', /selects no services/],
    ];
    const directory = await checkout(
        Object.fromEntries(
            cases.map(([yaml], index) =>
                index === 0
                    ? ['journeys/pilot.yaml', yaml]
                    : [`journeys/case-${index}.yaml`, yaml],
            ),
        ),
    );
    try {
        await assert.rejects(
            () => loadJourney(directory, 'pilot', nodeProjectFs),
            cases[0][1],
        );
        for (const [index, [, expected]] of cases.entries()) {
            if (index === 0) continue;
            await assert.rejects(
                () => loadJourney(directory, `case-${index}`, nodeProjectFs),
                expected,
            );
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('selectedJourney loads only a selected journey', async () => {
    const directory = await checkout({
        'journeys/pilot.yaml': 'services: [api]\n',
    });
    try {
        assert.equal(
            await selectedJourney(directory, undefined, nodeProjectFs),
            undefined,
        );
        const journey = await selectedJourney(
            directory,
            'pilot',
            nodeProjectFs,
        );
        assert.deepEqual(journey?.services, ['api']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('measureProject resolves the journey selected in .chs-dev.yaml', async () => {
    const directory = await checkout({
        'journeys/pilot.yaml': 'services: [api]\nlazy: [worker]\n',
        '.chs-dev.yaml': 'journey: pilot\n',
    });
    try {
        const measurement = await measureProject(directory, nodeProjectFs);
        assert.deepEqual(measurement.baseline.services, [
            'api',
            'redis',
            'worker',
        ]);
        assert.equal(measurement.baseline.serviceCount, 3);
        assert.deepEqual(measurement.baseline.lazyServices, ['worker']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('a journey measures as the target selection against the current one', async () => {
    const directory = await checkout({
        'journeys/pilot.yaml': 'services: [api, mocked]\nlazy: [worker]\n',
        '.chs-dev.yaml': 'services: [api]\n',
        'services/modules/m/heavy.docker-compose.yaml':
            'services:\n  mocked:\n    image: heavy\n    mem_limit: 64m\n',
    });
    try {
        const { baseline, journey } = await measureProject(
            directory,
            nodeProjectFs,
            'pilot',
        );
        assert.deepEqual(baseline.services, ['api', 'redis', 'worker']);
        assert.equal(baseline.serviceCount, 3);
        assert.deepEqual(baseline.lazyServices, []);
        assert.equal(journey?.name, 'pilot');
        assert.deepEqual(journey?.started, ['api', 'mocked', 'redis']);
        assert.deepEqual(journey?.lazy, ['worker']);
        assert.deepEqual(journey?.target.services, [
            'api',
            'mocked',
            'redis',
            'worker',
        ]);
        assert.deepEqual(journey?.notInJourney, []);
        assert.deepEqual(journey?.added, ['mocked']);
        assert.deepEqual(journey?.delta, {
            services: -1,
            dependencyEdges: 0,
            memoryLimitBytes: -64 * 1024 ** 2,
            memoryReservationBytes: 0,
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('explicit exclusions still win over journey membership', async () => {
    const directory = await checkout({
        'journeys/pilot.yaml': 'services: [api]\nlazy: [worker]\n',
        '.chs-dev.yaml':
            'services: [api, mocked]\nexcludedServices: [worker]\n',
        'services/modules/m/heavy.docker-compose.yaml':
            'services:\n  mocked:\n    image: heavy\n',
    });
    try {
        const { baseline, journey } = await measureProject(
            directory,
            nodeProjectFs,
            'pilot',
        );
        assert.deepEqual(baseline.services, ['api', 'mocked', 'redis']);
        assert.deepEqual(journey?.lazy, []);
        assert.deepEqual(journey?.target.services, ['api', 'redis']);
        assert.deepEqual(journey?.notInJourney, ['mocked']);
        assert.deepEqual(journey?.added, []);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('measuring an unknown journey names the missing file', async () => {
    const directory = await checkout({});
    try {
        await assert.rejects(
            () => measureProject(directory, nodeProjectFs, 'nope'),
            /Journey file journeys\/nope\.yaml does not exist/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('the usage cache demotes only derived, unlabelled members', () => {
    const entries = resolveServices(
        fixture(),
        readState('services: [api]'),
        undefined,
        { learned: new Set(['worker']) },
    );
    const worker = entries.find((entry) => entry.service === 'worker');
    assert.equal(worker?.lazy, true);
    assert.equal(worker?.lazySource, 'learned');
    // Learned members stay reclaimable so later runs can promote them;
    // redis is base and api is pinned: neither is cache-managed.
    assert.equal(worker?.reclaimable, true);
    assert.equal(
        entries.find((entry) => entry.service === 'api')?.reclaimable,
        undefined,
    );
    assert.equal(
        entries.find((entry) => entry.service === 'redis')?.reclaimable,
        undefined,
    );
});

test('explicit choices beat the usage cache', () => {
    const pinned = resolveServices(
        fixture(),
        readState('services: [api, worker]'),
        undefined,
        { learned: new Set(['worker']) },
    );
    assert.equal(
        pinned.find((entry) => entry.service === 'worker')?.lazy,
        undefined,
    );

    const labelled = new Map(fixture());
    labelled.set('worker', {
        ...labelled.get('worker')!,
        labels: { 'chs.start-mode': 'always' },
    });
    const always = resolveServices(
        labelled,
        readState('services: [api]'),
        undefined,
        { learned: new Set(['worker']) },
    );
    const worker = always.find((entry) => entry.service === 'worker');
    assert.equal(worker?.lazy, undefined);
    assert.equal(worker?.lazySource, undefined);
    assert.equal(worker?.reclaimable, undefined);

    const lazyLabel = new Map(fixture());
    lazyLabel.set('worker', {
        ...lazyLabel.get('worker')!,
        labels: { 'chs.start-mode': 'lazy' },
    });
    const lazy = resolveServices(
        lazyLabel,
        readState('services: [api]'),
        undefined,
        { learned: new Set(['worker']) },
    );
    const lazyWorker = lazy.find((entry) => entry.service === 'worker');
    assert.equal(lazyWorker?.lazy, true);
    assert.equal(lazyWorker?.lazySource, undefined);
});

test('journey lists outrank the cache and explicit lazy members are not reclaimable', () => {
    const entries = resolveServices(
        fixture(),
        readState('services: []'),
        { name: 'pilot', services: ['api'], lazy: ['worker'], excluded: [] },
        { learned: new Set(['mocked']) },
    );
    const worker = entries.find((entry) => entry.service === 'worker');
    assert.equal(worker?.lazy, true);
    assert.equal(worker?.reclaimable, undefined);
    // mocked is only in the closure when selected; here it stays out.
    assert.equal(
        entries.some((entry) => entry.service === 'mocked'),
        false,
    );
});

test('derived members are reclaimable so the proxy may reclaim them', () => {
    const entries = resolveServices(
        fixture(),
        readState('services: [api]'),
        undefined,
    );
    const worker = entries.find((entry) => entry.service === 'worker');
    assert.equal(worker?.reclaimable, true);
});

test('the measurement preview counts learned members as lazy', async () => {
    const directory = await checkout({
        '.chs-dev.yaml': 'services: [api]\n',
        '.chs-dev-usage.yaml':
            'format: chs-dev-usage\nversion: 1\nlearned: [worker]\n',
    });
    try {
        const { baseline } = await measureProject(
            directory,
            nodeProjectFs,
            undefined,
            true,
        );
        assert.deepEqual(baseline.lazyServices, ['worker']);
        const disabled = await measureProject(
            directory,
            nodeProjectFs,
            undefined,
            false,
        );
        assert.deepEqual(disabled.baseline.lazyServices, []);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
