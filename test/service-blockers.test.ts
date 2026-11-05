import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceBlockers } from '../src/domain/environment.js';
import type { PreparationExclusion } from '../src/domain/live.js';
import type { RuntimeContainer } from '../src/domain/live.js';

const enabled = ['api', 'web', 'felixvalidator', 'config-service'];

function container(
    service: string,
    evidence: { oomKilled?: boolean; exitCode?: number } = {},
): RuntimeContainer {
    return {
        service,
        id: `${service}-1`,
        projectName: 'p',
        projectDirectory: '/project',
        lifecycle: 'Exited',
        ...evidence,
    };
}

const exclusion = (): PreparationExclusion => ({
    variable: 'CHIPS_DATASOURCE_URL',
    services: ['config-service'],
    cause: 'CHIPS_DATASOURCE_URL is not set',
    remediation: 'Set CHIPS_DATASOURCE_URL in .env, then apply again.',
});

test('every causal state renders with its remediation', () => {
    const blockers = serviceBlockers({
        enabled,
        statuses: {
            api: 'Unhealthy',
            web: 'Stopped',
            felixvalidator: 'Stopped',
        },
        containers: [container('api', { exitCode: 137, oomKilled: true })],
        exclusions: [exclusion()],
        dependencies: { web: ['api'] },
        lazy: new Set(['felixvalidator']),
        coldStarting: [],
    });
    assert.deepEqual(
        blockers.map((blocker) => [blocker.service, blocker.state]),
        [
            ['api', 'failing'],
            ['config-service', 'excluded'],
            ['felixvalidator', 'lazy-idle'],
            ['web', 'blocked'],
        ],
    );
    const oom = blockers.find((blocker) => blocker.service === 'api')!;
    assert.match(oom.detail, /OOM-killed/);
    const excluded = blockers.find(
        (blocker) => blocker.service === 'config-service',
    )!;
    assert.match(excluded.detail, /CHIPS_DATASOURCE_URL/);
    assert.match(excluded.detail, /\.env/);
    const lazy = blockers.find(
        (blocker) => blocker.service === 'felixvalidator',
    )!;
    assert.match(lazy.detail, /starts on first request/);
});

test('a cold-starting service reports cold-starting with the proxy state', () => {
    const blockers = serviceBlockers({
        enabled: ['felixvalidator'],
        statuses: {},
        lazy: new Set(['felixvalidator']),
        coldStarting: ['felixvalidator'],
    });
    assert.deepEqual(blockers, [
        {
            service: 'felixvalidator',
            state: 'cold-starting',
            detail: 'starting on first request',
        },
    ]);
});

test('exit 137 without OOM reports the application exit, never OOM', () => {
    const blockers = serviceBlockers({
        enabled: ['worker'],
        statuses: { worker: 'Exited' },
        containers: [container('worker', { exitCode: 137 })],
    });
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0]!.state, 'failing');
    assert.match(blockers[0]!.detail, /did not confirm an OOM/);
});

test('an unmet dependency names the blocking service', () => {
    const blockers = serviceBlockers({
        enabled: ['web', 'kafka3'],
        statuses: { web: 'Stopped', kafka3: 'Unhealthy' },
        dependencies: { web: ['kafka3'] },
    });
    assert.deepEqual(blockers, [
        {
            service: 'kafka3',
            state: 'failing',
            detail: 'The container health check reports unhealthy.',
        },
        {
            service: 'web',
            state: 'blocked',
            detail: 'kafka3 not healthy',
        },
    ]);
});

test('healthy stacks produce no blockers and repeats are stable', () => {
    const input = {
        enabled: ['api', 'web'],
        statuses: { api: 'Healthy', web: 'Running' } as Record<
            string,
            never
        > as Record<string, never> as Record<
            string,
            import('../src/domain/runtime.js').ServiceStatus
        >,
        containers: [
            {
                service: 'api',
                id: 'a',
                projectName: 'p',
                projectDirectory: '/p',
                lifecycle: 'Running',
            } as RuntimeContainer,
        ],
    };
    const first = serviceBlockers(input);
    assert.deepEqual(first, []);
    assert.deepEqual(serviceBlockers(input), first);
});

test('one blocked and one lazy service render together without duplicates', () => {
    const input = {
        enabled: ['web', 'felixvalidator', 'api', 'kafka3'],
        statuses: {
            web: 'Stopped',
            api: 'Healthy',
            kafka3: 'Unhealthy',
        } as Record<string, never> as Record<
            string,
            import('../src/domain/runtime.js').ServiceStatus
        >,
        dependencies: { web: ['kafka3'] },
        lazy: new Set(['felixvalidator']),
        coldStarting: [],
    };
    const blockers = serviceBlockers(input);
    const services = blockers.map((blocker) => blocker.service);
    assert.equal(new Set(services).size, services.length);
    assert.deepEqual(services, ['felixvalidator', 'kafka3', 'web']);
    assert.equal(
        blockers.find((blocker) => blocker.service === 'web')?.state,
        'blocked',
    );
    assert.equal(
        blockers.find((blocker) => blocker.service === 'felixvalidator')?.state,
        'lazy-idle',
    );
    assert.deepEqual(serviceBlockers(input), blockers);
});
