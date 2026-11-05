import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { saveServiceChanges } from '../src/project/service-configuration.js';
import type { ServiceGroup } from '../src/project/catalog.js';
import { serviceDependencies } from '../src/domain/service-dependencies.js';

test('saves service overrides without dropping modules or unrelated settings', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-actions-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['api', 'proxy'],
            definitions: {
                api: {
                    module: 'app',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                    development: true,
                },
                proxy: {
                    module: 'infrastructure',
                    dependencies: [],
                    base: true,
                    deprecated: false,
                },
            },
        },
    ];
    const path = join(directory, '.chs-dev.yaml');
    await writeFile(
        path,
        '# existing settings\nmodules: [app]\nservices: [other]\ncustom: keep\n',
    );
    const disabled = await saveServiceChanges({
        directory,
        name: 'api',
        enabled: false,
        development: true,
        groups,
    });
    assert.deepEqual(disabled.api, {
        enabled: 'No',
        mode: 'Development',
        excluded: true,
    });
    const saved = await readFile(path, 'utf8');
    assert.match(saved, /# existing settings/);
    assert.deepEqual(parse(saved).modules, ['app']);
    assert.deepEqual(parse(saved).services, ['other']);
    assert.equal(parse(saved).custom, 'keep');
    const enabled = await saveServiceChanges({
        directory,
        name: 'api',
        enabled: true,
        development: false,
        groups,
    });
    assert.deepEqual(enabled.api, { enabled: 'Yes', mode: 'Service' });
    assert.deepEqual(parse(await readFile(path, 'utf8')).excludedServices, []);
    await assert.rejects(
        saveServiceChanges({
            directory,
            name: 'proxy',
            enabled: false,
            development: false,
            groups,
        }),
        /must remain enabled/,
    );
    await assert.rejects(
        saveServiceChanges({
            directory,
            name: 'proxy',
            enabled: true,
            development: true,
            groups,
        }),
        /does not support/,
    );
    await writeFile(path, 'services: broken');
    await assert.rejects(
        saveServiceChanges({
            directory,
            name: 'api',
            enabled: true,
            development: false,
            groups,
        }),
    );
    assert.equal(await readFile(path, 'utf8'), 'services: broken');
});

test('stages and saves dependency exclusions, preserves other exclusions, and handles cycles', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-dependencies-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const definition = (dependencies: string[], base = false) => ({
        module: 'app',
        dependencies,
        base,
        deprecated: false,
    });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['api', 'db', 'cache', 'proxy'],
            definitions: {
                api: definition(['db', 'proxy']),
                db: definition(['cache']),
                cache: definition(['api']),
                proxy: definition([], true),
            },
        },
    ];
    assert.deepEqual(serviceDependencies('api', groups), [
        { name: 'cache', direct: false, required: false },
        { name: 'db', direct: true, required: false },
        { name: 'proxy', direct: true, required: true },
    ]);
    const path = join(directory, '.chs-dev.yaml');
    await writeFile(path, 'services: [api]\nexcludedServices: [unrelated]\n');
    const excluded = await saveServiceChanges({
        directory,
        name: 'api',
        enabled: true,
        development: false,
        groups,
        exclusions: { db: true },
    });
    assert.equal(excluded.db?.excluded, true);
    assert.equal(excluded.db?.enabled, 'No');
    assert.equal(excluded.cache?.enabled, 'No');
    assert.deepEqual(parse(await readFile(path, 'utf8')).excludedServices, [
        'unrelated',
        'db',
    ]);
    const allowed = await saveServiceChanges({
        directory,
        name: 'api',
        enabled: true,
        development: false,
        groups,
        exclusions: { db: false },
    });
    assert.equal(allowed.db?.enabled, 'Yes');
    assert.equal(allowed.cache?.enabled, 'Yes');
    assert.deepEqual(parse(await readFile(path, 'utf8')).excludedServices, [
        'unrelated',
    ]);
    await assert.rejects(
        saveServiceChanges({
            directory,
            name: 'api',
            enabled: true,
            development: false,
            groups,
            exclusions: { unrelated: true },
        }),
        /not a dependency/,
    );
    await assert.rejects(
        saveServiceChanges({
            directory,
            name: 'api',
            enabled: true,
            development: false,
            groups,
            exclusions: { proxy: true },
        }),
        /required infrastructure/,
    );
});
