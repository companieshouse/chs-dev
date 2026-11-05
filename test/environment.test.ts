import assert from 'node:assert/strict';
import { test } from 'node:test';
import { environmentSummary } from '../src/domain/environment.js';
import type { ServiceDetails } from '../src/domain/services.js';

const details: Record<string, ServiceDetails> = {
    api: { enabled: 'Yes', mode: 'Service' },
    web: { enabled: 'Yes', mode: 'Development' },
    job: { enabled: 'Yes', mode: 'Service' },
    other: { enabled: 'No', mode: 'Service' },
};

test('reports ready when every enabled service is up or completed', () => {
    const summary = environmentSummary(
        details,
        { api: 'Healthy', web: 'Running', job: 'Completed', other: 'Exited' },
        'ready',
    );
    assert.equal(summary.state, 'Ready');
    assert.equal(summary.label, 'Ready 3/3');
});

test('reports starting while services start or Live applies changes', () => {
    assert.equal(
        environmentSummary(
            details,
            { api: 'Starting', web: 'Running', job: 'Completed' },
            'ready',
        ).label,
        'Starting 2/3',
    );
    assert.equal(
        environmentSummary(details, { api: 'Exited' }, 'ready', true).state,
        'Starting',
    );
});

test('reports failing services ahead of services still starting', () => {
    const summary = environmentSummary(
        details,
        { api: 'Exited', web: 'Starting', job: 'Unhealthy' },
        'ready',
    );
    assert.equal(summary.state, 'Issues');
    assert.deepEqual(summary.failed, ['api', 'job']);
    assert.equal(summary.label, '2 failing · 0/3 up');
});

test('reports stopped, partial, unknown and empty environments', () => {
    assert.equal(environmentSummary(details, {}, 'ready').state, 'Stopped');
    assert.equal(
        environmentSummary(details, { api: 'Running' }, 'ready').label,
        'Partially up 1/3',
    );
    assert.equal(environmentSummary(details, {}, 'error').state, 'Unknown');
    assert.equal(environmentSummary(details, {}, 'loading').state, 'Checking');
    assert.equal(
        environmentSummary(
            { api: { enabled: 'No', mode: 'Service' } },
            {},
            'ready',
        ).state,
        'Empty',
    );
});
