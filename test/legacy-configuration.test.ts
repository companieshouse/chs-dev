import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
    editSelections,
    projectSelections,
} from '../src/domain/configuration.js';
import { resolveServiceState } from '../src/domain/service-state.js';
import {
    configurationSnapshot,
    saveLegacyChanges,
} from '../src/project/configuration.js';
import { dependencyDot } from '../src/infrastructure/dependency-diagrams.js';
import type { ServiceGroup } from '../src/domain/services.js';

const groups: ServiceGroup[] = [
    {
        name: 'app',
        services: ['api', 'worker'],
        definitions: {
            api: {
                module: 'app',
                dependencies: ['shared', 'private'],
                development: true,
            },
            worker: { module: 'app', dependencies: ['shared'] },
        },
    },
    {
        name: 'Infrastructure',
        services: ['shared', 'private', 'db'],
        definitions: {
            shared: { dependencies: ['db'] },
            private: { dependencies: [] },
            db: { dependencies: [], base: true },
        },
    },
];

test('legacy service disable removes an explicit root while preserving module and dependency requirements', () => {
    const initial = projectSelections({
        modules: ['app'],
        services: ['api', 'shared'],
        servicesWithLiveUpdate: ['api'],
        excludedServices: ['private'],
    });
    const next = editSelections(
        initial,
        { topic: 'services', action: 'disable', names: ['api', 'shared'] },
        groups,
    );
    assert.deepEqual(next.services, []);
    assert.deepEqual(next.modules, ['app']);
    assert.deepEqual(next.servicesWithLiveUpdate, ['api']);
    assert.deepEqual(next.excludedServices, ['private']);
    assert.equal(resolveServiceState(next, groups).api.enabled, 'Yes');
    assert.equal(resolveServiceState(next, groups).shared.enabled, 'Yes');
    assert.deepEqual(initial.services, ['api', 'shared']);
});

test('dependency exclusions affect direct private dependencies while retaining shared and base services', () => {
    const initial = projectSelections({ services: ['api', 'worker'] });
    const next = editSelections(
        initial,
        {
            topic: 'exclusions',
            action: 'add',
            names: ['api'],
            dependencies: true,
        },
        groups,
    );
    assert.deepEqual(next.excludedServices, ['api', 'private']);
    assert.equal(resolveServiceState(next, groups).shared.enabled, 'Yes');
    assert.throws(
        () =>
            editSelections(
                initial,
                { topic: 'services', action: 'enable', names: ['constructor'] },
                groups,
            ),
        /Unknown service/,
    );
    assert.throws(
        () =>
            editSelections(
                initial,
                { topic: 'exclusions', action: 'add', names: ['db'] },
                groups,
            ),
        /required infrastructure/,
    );
    assert.throws(
        () =>
            editSelections(
                initial,
                { topic: 'development', action: 'enable', names: ['worker'] },
                groups,
            ),
        /development mode/,
    );
    assert.throws(
        () =>
            editSelections(
                projectSelections({}),
                { topic: 'development', action: 'enable', names: ['api'] },
                groups,
            ),
        /Enable api/,
    );
});

test('legacy batch saves validate before writing and preserve YAML comments and unrelated fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-legacy-state-'));
    const path = join(directory, '.chs-dev.yaml');
    const original =
        '# keep header\nmodules: []\nservices: [worker] # keep selections\nservicesWithLiveUpdate: []\nexcludedServices: []\ncustom:\n  setting: original # keep custom\n';
    try {
        await writeFile(path, original);
        const initial = await configurationSnapshot(directory);
        await assert.rejects(
            saveLegacyChanges(
                directory,
                groups,
                {
                    topic: 'services',
                    action: 'enable',
                    names: ['api', 'missing'],
                },
                initial.revision,
            ),
            /Unknown service/,
        );
        assert.equal(await readFile(path, 'utf8'), original);
        let checkpoint = '';
        const saved = await saveLegacyChanges(
            directory,
            groups,
            { topic: 'services', action: 'enable', names: ['api', 'worker'] },
            initial.revision,
            async (revision) => {
                checkpoint = revision;
                assert.equal(await readFile(path, 'utf8'), original);
            },
        );
        assert.equal(checkpoint, saved.revision);
        const contents = await readFile(path, 'utf8');
        assert.match(contents, /keep header/);
        assert.match(contents, /keep selections/);
        assert.match(contents, /keep custom/);
        assert.equal(parse(contents).custom.setting, 'original');
        assert.deepEqual(saved.selections.services, ['worker', 'api']);
        await assert.rejects(
            saveLegacyChanges(
                directory,
                groups,
                { topic: 'modules', action: 'enable', names: ['app'] },
                initial.revision,
            ),
            /Configuration changed/,
        );
        assert.deepEqual(
            (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
            [],
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('external writes during a batch save are preserved and temporary files are removed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-legacy-conflict-'));
    const path = join(directory, '.chs-dev.yaml');
    try {
        await writeFile(path, '{}\n');
        const initial = await configurationSnapshot(directory);
        await assert.rejects(
            saveLegacyChanges(
                directory,
                groups,
                { topic: 'services', action: 'enable', names: ['api'] },
                initial.revision,
                async () => {
                    await writeFile(path, 'services: [worker]\n');
                },
            ),
            /Configuration changed/,
        );
        assert.equal(await readFile(path, 'utf8'), 'services: [worker]\n');
        assert.deepEqual(await readdir(directory), ['.chs-dev.yaml']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('dependency diagrams include isolated nodes and remain finite for cyclic dependencies', () => {
    const cyclic = [
        {
            name: 'cycle',
            services: ['a', 'b', 'isolated'],
            definitions: {
                a: { dependencies: ['b'] },
                b: { dependencies: ['a'] },
                isolated: { dependencies: [] },
            },
        },
    ];
    const dot = dependencyDot(cyclic);
    assert.match(dot, /"isolated";/);
    assert.match(dot, /"a" -> "b";/);
    assert.match(dot, /"b" -> "a";/);
    assert.ok(dependencyDot(cyclic, 'a').length < 500);
    assert.throws(() => dependencyDot(cyclic, 'missing'), /Unknown service/);
});
