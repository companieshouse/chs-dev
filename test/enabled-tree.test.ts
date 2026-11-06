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

test('enabled forest shows each root once and keeps branch guides across module dependencies', () => {
    const definition = (module: string, dependencies: string[]) => ({
        module,
        dependencies,
        base: false,
        deprecated: false,
    });
    const groups: ServiceGroup[] = [
        {
            name: 'app',
            services: ['worker', 'api'],
            definitions: {
                api: definition('app', ['cache']),
                worker: definition('app', ['db']),
            },
        },
        {
            name: 'infrastructure',
            services: ['db', 'cache'],
            definitions: {
                cache: definition('infrastructure', ['db']),
                db: definition('infrastructure', []),
            },
        },
    ];
    const details: Record<string, ServiceDetails> = {
        api: { enabled: 'Yes', mode: 'Service' },
        worker: { enabled: 'Yes', mode: 'Service' },
        cache: { enabled: 'Yes', mode: 'Service' },
        db: { enabled: 'Yes', mode: 'Service' },
    };
    assert.deepEqual(enabledTree(groups, details), [
        { kind: 'module', name: 'app', prefix: '' },
        { kind: 'service', name: 'api', prefix: '├─ ', reference: undefined },
        {
            kind: 'service',
            name: 'cache',
            prefix: '│  └─ ',
            reference: undefined,
        },
        {
            kind: 'service',
            name: 'db',
            prefix: '│     └─ ',
            reference: undefined,
        },
        {
            kind: 'service',
            name: 'worker',
            prefix: '└─ ',
            reference: undefined,
        },
        { kind: 'service', name: 'db', prefix: '   └─ ', reference: 'shared' },
    ]);
});
