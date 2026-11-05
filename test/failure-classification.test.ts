import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    classifyFailure,
    type FailureEvidence,
} from '../src/domain/failure-classification.js';

const fixtures: Record<string, FailureEvidence> = {
    oom: { oomKilled: true, exitCode: 137 },
    health: { health: 'unhealthy' },
    dependency: {
        unmetDependency: { service: 'database', condition: 'service_healthy' },
    },
    configuration: { missingVariable: 'API_URL' },
    'application-exit': { exitCode: 1, oomKilled: false },
    unknown: {},
};

test('every failure class has a fixture and classifies to itself', () => {
    for (const [expected, evidence] of Object.entries(fixtures)) {
        const result = classifyFailure(evidence);
        assert.equal(result.class, expected, expected);
        assert.match(result.reason, /\S/);
    }
});

test('engine-confirmed OOM wins even with other evidence present', () => {
    const result = classifyFailure({
        oomKilled: true,
        exitCode: 137,
        health: 'unhealthy',
        missingVariable: 'API_URL',
    });
    assert.equal(result.class, 'oom');
    assert.match(result.reason, /engine confirmed/i);
});

test('exit 137 without OOMKilled is an application exit, never an OOM', () => {
    const explicitFalse = classifyFailure({ oomKilled: false, exitCode: 137 });
    assert.equal(explicitFalse.class, 'application-exit');
    assert.match(explicitFalse.reason, /did not confirm an OOM/);

    const unobserved = classifyFailure({ exitCode: 137 });
    assert.equal(unobserved.class, 'application-exit');
    assert.match(unobserved.reason, /did not confirm an OOM/);

    assert.equal(
        classifyFailure({ exitCode: 137, health: 'unhealthy' }).class,
        'application-exit',
    );
});

test('an unmet dependency names the blocking service and condition', () => {
    const result = classifyFailure(fixtures.dependency);
    assert.equal(result.class, 'dependency');
    assert.match(result.reason, /database/);
    assert.match(result.reason, /service_healthy/);
});

test('a missing variable classifies as configuration', () => {
    const result = classifyFailure(fixtures.configuration);
    assert.equal(result.class, 'configuration');
    assert.match(result.reason, /API_URL/);
});

test('non-zero exits classify as application exits with the code', () => {
    const result = classifyFailure({ exitCode: 1, oomKilled: false });
    assert.equal(result.class, 'application-exit');
    assert.match(result.reason, /code 1/);
});

test('exit evidence outranks later rules per the ordered policy', () => {
    assert.equal(
        classifyFailure({ exitCode: 137, health: 'unhealthy' }).class,
        'application-exit',
    );
    assert.equal(
        classifyFailure({ exitCode: 1, missingVariable: 'API_URL' }).class,
        'application-exit',
    );
});

test('unknown evidence stays unknown and names the missing inspections', () => {
    const result = classifyFailure(fixtures.unknown);
    assert.equal(result.class, 'unknown');
    assert.deepEqual(result.missingInspections, [
        'docker inspect State.OOMKilled',
        'docker inspect State.ExitCode',
        'container health status',
        'dependency conditions and required variables',
    ]);
    assert.match(result.reason, /Evidence is inconclusive/);
    assert.match(result.reason, /State\.OOMKilled/);
});

test('classification is deterministic for identical evidence', () => {
    const evidence = { oomKilled: false, exitCode: 137, health: 'unhealthy' };
    assert.deepEqual(classifyFailure(evidence), classifyFailure(evidence));
});
