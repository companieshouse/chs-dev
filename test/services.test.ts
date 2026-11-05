import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readServices } from '../src/project/catalog.js';
import { filterServices } from '../src/domain/service-filter.js';
import type { ServiceGroup, ServiceDetails } from '../src/domain/services.js';

test('service filtering combines names and configured enabled state without classifying unknown values', () => {
    const groups: ServiceGroup[] = [
        { name: 'accounts', services: ['api', 'worker', 'unknown', 'missing'] },
        { name: 'Infrastructure', services: ['redis'] },
    ];
    const details: Record<string, ServiceDetails> = {
        api: { enabled: 'Yes', mode: 'Service' },
        worker: { enabled: 'No', mode: 'Service' },
        unknown: { enabled: 'Unknown', mode: 'Unknown' },
        redis: { enabled: 'Yes', mode: 'Service' },
    };
    assert.deepEqual(
        filterServices(groups, '', { enabled: 'All', details }),
        groups,
    );
    assert.deepEqual(
        filterServices(groups, '', { enabled: 'Enabled', details }),
        [{ ...groups[0], services: ['api'] }, groups[1]],
    );
    assert.deepEqual(
        filterServices(groups, ' ACCOUNTS ', { enabled: 'Disabled', details }),
        [{ ...groups[0], services: ['worker'] }],
    );
    assert.deepEqual(
        filterServices(groups, 'RED', { enabled: 'Enabled', details }),
        [groups[1]],
    );
    assert.deepEqual(
        filterServices(groups, 'redis', { enabled: 'Disabled', details }),
        [],
    );
    assert.deepEqual(
        filterServices(groups, '', { enabled: 'Disabled', details: {} }),
        [],
    );
    assert.deepEqual(groups[0].services, [
        'api',
        'worker',
        'unknown',
        'missing',
    ]);
});

test('reads service keys, groups modules, includes infrastructure, and ignores assets', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-services-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'services/modules/accounts/assets'), {
        recursive: true,
    });
    await mkdir(join(root, 'services/infrastructure'), { recursive: true });
    await writeFile(
        join(root, 'services/modules/accounts/bundle.docker-compose.yaml'),
        'services:\n  zebra: {}\n  alpha: {}\n',
    );
    await writeFile(
        join(root, 'services/modules/accounts/extra.docker-compose.yml'),
        'services:\n  alpha: {}\n',
    );
    await writeFile(
        join(
            root,
            'services/modules/accounts/assets/ignored.docker-compose.yaml',
        ),
        'services:\n  ignored: {}\n',
    );
    await writeFile(
        join(root, 'services/infrastructure/docker-compose.yaml'),
        'services:\n  ingress-proxy: {}\nnetworks:\n  chs: {}\n',
    );
    await mkdir(join(root, 'services/infrastructure/telemetry'));
    await writeFile(
        join(
            root,
            'services/infrastructure/telemetry/stack.docker-compose.yaml',
        ),
        'services:\n  telemetry: {}\n',
    );
    const config = { directory: root, valid: true, message: '' };
    const groups = await readServices(config);
    assert.deepEqual(
        groups.map(({ name, services }) => ({ name, services })),
        [
            { name: 'accounts', services: ['alpha', 'zebra'] },
            {
                name: 'Infrastructure',
                services: ['ingress-proxy', 'telemetry'],
            },
        ],
    );
    assert.deepEqual(filterServices(groups, 'ALP'), [
        { ...groups[0], services: ['alpha'] },
    ]);
    assert.deepEqual(filterServices(groups, 'accounts'), [groups[0]]);
    assert.deepEqual(filterServices(groups, 'missing'), []);
    assert.deepEqual(filterServices(groups, ''), groups);
    await assert.rejects(
        readServices({ ...config, valid: false, message: 'Invalid checkout' }),
        /Cannot read services: Invalid checkout/,
    );
    await writeFile(
        join(root, 'services/modules/accounts/broken.docker-compose.yaml'),
        'services: [',
    );
    await assert.rejects(
        readServices(config),
        /Cannot read .*broken.docker-compose.yaml/,
    );
});
