import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dependencyTree } from '../src/domain/service-dependencies.js';
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
