import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    dependencyOrder,
    dependencyTree,
    serviceDependencies,
} from '../src/domain/service-dependencies.js';
import type { ServiceGroup } from '../src/project/catalog.js';

test('renders sorted branches, shared references, and cycles without infinite expansion', () => {
    const definition = (dependencies: string[], base = false) => ({
        module: 'app',
        dependencies,
        base,
        deprecated: false,
    });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['root', 'api', 'worker', 'db'],
            definitions: {
                root: definition(['worker', 'api', 'api']),
                api: definition(['db']),
                db: definition(['root'], true),
                worker: definition(['db']),
            },
        },
    ];
    const rows = dependencyTree('root', groups);
    assert.deepEqual(
        rows.map(
            (row) =>
                `${row.prefix}${row.name}${row.reference ? ` (${row.reference})` : ''}`,
        ),
        [
            '├─ api',
            '│  └─ db',
            '│     └─ root (cycle)',
            '└─ worker',
            '   └─ db (shared)',
        ],
    );
    assert.equal(rows[1]?.required, true);
    assert.equal(rows[4]?.required, true);
    assert.deepEqual(dependencyTree('unknown', groups), []);
});

test('dependency queries retain uncatalogued dependencies without marking them required', () => {
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['root', 'db', 'cache'],
            definitions: {
                root: {
                    module: 'app',
                    dependencies: ['db', 'missing'],
                    base: false,
                    deprecated: false,
                },
                db: {
                    module: 'app',
                    dependencies: ['cache'],
                    base: true,
                    deprecated: false,
                },
                cache: {
                    module: 'app',
                    dependencies: ['root'],
                    base: false,
                    deprecated: false,
                },
            },
        },
    ];
    assert.deepEqual(serviceDependencies('root', groups), [
        { name: 'cache', direct: false, required: false },
        { name: 'db', direct: true, required: true },
        { name: 'missing', direct: true, required: false },
    ]);
    assert.deepEqual(dependencyTree('root', groups).at(-1), {
        name: 'missing',
        prefix: '└─ ',
        required: false,
        reference: undefined,
    });
});

test('start chains put dependencies before their caller and visit shared cyclic members once', () => {
    const dependencies = new Map([
        ['web', ['api', 'worker']],
        ['api', ['db']],
        ['worker', ['db']],
        ['db', ['api']],
    ]);
    assert.deepEqual(dependencyOrder('web', dependencies), [
        'db',
        'api',
        'worker',
        'web',
    ]);
    assert.deepEqual(dependencyOrder('unknown', dependencies), ['unknown']);
});
