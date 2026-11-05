import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enabledTree } from '../src/domain/enabled-tree.js';
import type { ServiceGroup } from '../src/project/catalog.js';
import type { ServiceDetails } from '../src/project/service-state.js';

test('enabled forest groups roots, omits disabled nodes, and includes shared dependencies and cyclic components', () => {
    const definition = (dependencies: string[]) => ({
        dependencies,
        module: 'app',
        base: false,
        deprecated: false,
    });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['api', 'web', 'db', 'disabled', 'a', 'b'],
            definitions: {
                api: definition(['db', 'disabled']),
                web: definition(['db']),
                db: definition([]),
                disabled: definition([]),
                a: definition(['b']),
                b: definition(['a']),
            },
        },
    ];
    const details: Record<string, ServiceDetails> = Object.fromEntries(
        groups[0]!.services.map((name) => [
            name,
            { enabled: name === 'disabled' ? 'No' : 'Yes', mode: 'Service' },
        ]),
    );
    const rows = enabledTree(groups, details);
    assert.deepEqual(
        [
            ...new Set(
                rows
                    .filter((row) => row.kind === 'service')
                    .map((row) => row.name),
            ),
        ].sort(),
        ['a', 'api', 'b', 'db', 'web'],
    );
    assert.equal(rows[0]?.kind, 'module');
    assert.ok(
        rows.some((row) => row.name === 'a' && row.reference === 'cycle'),
    );
    assert.ok(
        rows.some((row) => row.name === 'db' && row.reference === 'shared'),
    );
    assert.deepEqual(enabledTree(groups, {}), []);
    details.db = { enabled: 'No', mode: 'Service', excluded: true };
    assert.ok(!enabledTree(groups, details).some((row) => row.name === 'db'));
});
