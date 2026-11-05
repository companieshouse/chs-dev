import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createAccounting,
    healthcheckPaths,
    isHealthcheck,
} from '../src/proxy/accounting.js';

test('healthcheck paths come from the engine healthcheck command', () => {
    assert.deepEqual(
        healthcheckPaths({
            Test: [
                'CMD-SHELL',
                "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/registers-data-api/healthcheck || exit 1",
            ],
        }),
        ['/registers-data-api/healthcheck'],
    );
    assert.deepEqual(
        healthcheckPaths({
            Test: ['CMD', 'curl', '-f', 'http://localhost:3000/health'],
        }),
        ['/health'],
    );
    assert.deepEqual(
        healthcheckPaths({
            Test: ['CMD-SHELL', 'wget -qO- localhost:8080/actuator/health'],
        }),
        ['/actuator/health'],
    );
    assert.deepEqual(healthcheckPaths(undefined), []);
    assert.deepEqual(healthcheckPaths({ Test: ['CMD-SHELL', 'exit 0'] }), []);
});

test('healthcheck probes match exactly, with slash tolerance and no query', () => {
    const checks = ['/registers-data-api/healthcheck'];
    assert.ok(isHealthcheck('/registers-data-api/healthcheck', checks));
    assert.ok(isHealthcheck('/registers-data-api/healthcheck/', checks));
    assert.ok(isHealthcheck('/registers-data-api/healthcheck?probe=1', checks));
    assert.ok(!isHealthcheck('/registers-data-api/healthcheck/extra', checks));
    assert.ok(!isHealthcheck('/filing-history', checks));
});

test('real traffic counts per service; healthcheck traffic is excluded', () => {
    const accounting = createAccounting();
    const checks = ['/registers-data-api/healthcheck'];
    accounting.record('registers-data-api', '/company/OC123456', checks);
    accounting.record('registers-data-api', '/company/OC123456', checks);
    accounting.record(
        'registers-data-api',
        '/registers-data-api/healthcheck',
        checks,
    );
    accounting.record('registers-data-api', '/', checks);
    assert.deepEqual(accounting.snapshot(), {
        counts: { 'registers-data-api': 3 },
        excluded: { 'registers-data-api': 1 },
    });
    assert.equal(accounting.count('registers-data-api'), 3);
});

test('counters reset per service and stay sorted in snapshots', () => {
    const accounting = createAccounting();
    accounting.record('worker', '/a', []);
    accounting.record('api', '/b', []);
    accounting.record('worker', '/c', []);
    accounting.reset('worker');
    accounting.record('api', '/d', []);
    assert.deepEqual(accounting.snapshot(), {
        counts: { api: 2 },
        excluded: {},
    });
});
