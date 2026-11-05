import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleRows, centeredStart } from '../src/tui/models/modules.js';
import { dependencyTree } from '../src/domain/service-dependencies.js';
import type { ServiceGroup } from '../src/project/catalog.js';

test('module browser expands, filters services and modules, and handles no matches', () => {
    const groups: ServiceGroup[] = [
        { name: 'accounts', services: ['api', 'web'] },
        { name: 'presenters', services: ['presenters-api'] },
        { name: 'empty', services: [] },
    ];
    assert.equal(moduleRows(groups, '', {}).length, 3);
    assert.deepEqual(
        moduleRows(groups, '', { accounts: true }).map((row) => row.name),
        ['accounts', 'api', 'web', 'presenters', 'empty'],
    );
    assert.deepEqual(
        moduleRows(groups, 'WEB', {}).map((row) => row.name),
        ['accounts', 'web'],
    );
    assert.deepEqual(
        moduleRows(groups, 'accounts', {}).map((row) => row.name),
        ['accounts', 'api', 'web'],
    );
    assert.deepEqual(
        moduleRows(groups, 'web', { accounts: false }).map((row) => row.name),
        ['accounts'],
    );
    assert.deepEqual(moduleRows(groups, 'missing', {}), []);
    assert.equal(centeredStart(0, 10, 30), 0);
    assert.equal(centeredStart(15, 10, 30), 10);
    assert.equal(centeredStart(29, 10, 30), 20);
    assert.equal(centeredStart(1, 10, 3), 0);
});

test('used-by tree follows reverse edges through indirect consumers', () => {
    const definition = (dependencies: string[]) => ({
        module: 'app',
        dependencies,
        base: false,
        deprecated: false,
    });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['web', 'api', 'db'],
            definitions: {
                web: definition(['api', 'db']),
                api: definition(['db']),
                db: definition([]),
            },
        },
    ];
    const tree = dependencyTree('db', groups, 'dependents');
    assert.deepEqual(
        tree.map((row) => [row.prefix, row.name, row.reference]),
        [
            ['├─ ', 'api', undefined],
            ['│  └─ ', 'web', undefined],
            ['└─ ', 'web', 'shared'],
        ],
    );
    assert.deepEqual(dependencyTree('web', groups, 'dependents'), []);
});
