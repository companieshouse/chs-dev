import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mapping } from '../src/project/compose.js';
import {
    attributeEnvironment,
    blockedSet,
} from '../src/project/attribution.js';

function compose(
    services: Record<string, unknown>,
    top: Record<string, unknown> = {},
): Mapping {
    return { ...top, services };
}

const stack = compose(
    {
        db: {
            image: 'postgres',
            environment: { PASSWORD: '${DB_PASSWORD}', ID: '${SHARED}' },
        },
        api: {
            image: 'api',
            environment: { URL: 'postgres://db/${DB_NAME}' },
            depends_on: ['db'],
        },
        worker: { image: 'worker', depends_on: ['api'] },
        side: { image: 'side', environment: { TOKEN: '${SHARED}' } },
    },
    { networks: { default: { driver: '${NETWORK_DRIVER}' } } },
);

const required = ['DB_NAME', 'DB_PASSWORD', 'NETWORK_DRIVER', 'SHARED'];

const graph = new Map<string, readonly string[]>([
    ['db', []],
    ['api', ['db']],
    ['worker', ['api']],
    ['side', []],
]);

test('variables attribute to the services whose own spec interpolates them', () => {
    const attribution = attributeEnvironment(stack, required);
    assert.deepEqual(attribution.owners, {
        DB_NAME: ['api'],
        DB_PASSWORD: ['db'],
        SHARED: ['db', 'side'],
    });
    assert.deepEqual(attribution.unattributable, ['NETWORK_DRIVER']);
});

test('top-level and initialization variables are reported as unattributable', () => {
    const attribution = attributeEnvironment(stack, [
        ...required,
        'INIT_TOKEN',
    ]);
    assert.deepEqual(attribution.unattributable, [
        'INIT_TOKEN',
        'NETWORK_DRIVER',
    ]);
});

test('a missing variable blocks its owner and all transitive dependents', () => {
    const attribution = attributeEnvironment(stack, required);
    const result = blockedSet(['DB_PASSWORD'], attribution, graph);
    assert.deepEqual(result.blocked, {
        DB_PASSWORD: ['api', 'db', 'worker'],
    });
    assert.deepEqual(result.unattributable, []);
});

test('multiple missing variables block independently', () => {
    const attribution = attributeEnvironment(stack, required);
    const result = blockedSet(['DB_PASSWORD', 'DB_NAME'], attribution, graph);
    assert.deepEqual(result.blocked, {
        DB_NAME: ['api', 'worker'],
        DB_PASSWORD: ['api', 'db', 'worker'],
    });
});

test('a variable owned by several services blocks all of them', () => {
    const attribution = attributeEnvironment(stack, required);
    const result = blockedSet(['SHARED'], attribution, graph);
    assert.deepEqual(result.blocked, {
        SHARED: ['api', 'db', 'side', 'worker'],
    });
});

test('an unattributable missing variable is reported and blocks nothing', () => {
    const attribution = attributeEnvironment(stack, required);
    const result = blockedSet(
        ['NETWORK_DRIVER', 'DB_PASSWORD'],
        attribution,
        graph,
    );
    assert.deepEqual(result.unattributable, ['NETWORK_DRIVER']);
    assert.deepEqual(result.blocked, {
        DB_PASSWORD: ['api', 'db', 'worker'],
    });
});

test('services outside the selected set are not reported as blocked', () => {
    const attribution = attributeEnvironment(stack, required);
    const result = blockedSet(
        ['DB_PASSWORD'],
        attribution,
        graph,
        new Set(['db', 'api']),
    );
    assert.deepEqual(result.blocked, { DB_PASSWORD: ['api', 'db'] });
});

test('duplicate missing variables produce one entry', () => {
    const attribution = attributeEnvironment(stack, required);
    const result = blockedSet(
        ['DB_PASSWORD', 'DB_PASSWORD'],
        attribution,
        graph,
    );
    assert.deepEqual(Object.keys(result.blocked), ['DB_PASSWORD']);
});

test('the computation is deterministic and does not mutate its inputs', () => {
    const before = JSON.stringify(stack);
    const requiredCopy = [...required];
    const first = blockedSet(
        ['DB_PASSWORD', 'NETWORK_DRIVER'],
        attributeEnvironment(stack, requiredCopy),
        graph,
    );
    const second = blockedSet(
        ['DB_PASSWORD', 'NETWORK_DRIVER'],
        attributeEnvironment(stack, requiredCopy),
        graph,
    );
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(stack), before);
    assert.deepEqual(requiredCopy, required);
});
