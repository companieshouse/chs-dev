import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readServiceState } from '../src/project/service-state.js';
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
    assert.deepEqual(details.api, { enabled: 'Yes', mode: 'Development' });
    assert.equal(details.db?.enabled, 'Yes');
    assert.equal(details.excluded?.enabled, 'No');
    assert.equal(details.old?.enabled, 'No');
    assert.deepEqual(details['ch-service-mock'], {
        enabled: 'Yes',
        mode: 'Mock',
    });
    await writeFile(join(directory, '.chs-dev.yaml'), 'services: invalid');
    await assert.rejects(
        readServiceState(directory, groups),
        /Invalid services/,
    );
});
