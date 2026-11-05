import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    environmentSummary,
    serviceBlockers,
} from '../src/domain/environment.js';
import {
    containerStatus,
    statusesForProject,
    type ContainerSnapshot,
} from '../src/infrastructure/docker-status.js';

test('separates running from health and preserves stopped lifecycle states', () => {
    assert.equal(containerStatus({ Status: 'running' }), 'Running');
    assert.equal(
        containerStatus({ Status: 'running', Health: { Status: 'healthy' } }),
        'Healthy',
    );
    assert.equal(
        containerStatus({ Status: 'running', Health: { Status: 'unhealthy' } }),
        'Unhealthy',
    );
    assert.equal(
        containerStatus({ Status: 'running', Health: { Status: 'starting' } }),
        'Starting',
    );
    assert.equal(
        containerStatus({ Status: 'exited', Health: { Status: 'healthy' } }),
        'Exited',
    );
    assert.equal(containerStatus({ Status: 'restarting' }), 'Restarting');
    assert.equal(containerStatus({ Status: 'created' }), 'Stopped');
    assert.equal(containerStatus({ Status: 'unexpected' }), 'Unknown');
});

test('distinguishes completed jobs, stopped services and crashes by exit code', () => {
    assert.equal(
        containerStatus({ Status: 'exited', ExitCode: 0 }),
        'Completed',
    );
    assert.equal(
        containerStatus({
            Status: 'exited',
            ExitCode: 0,
            Health: { Status: 'unhealthy' },
        }),
        'Stopped',
    );
    assert.equal(
        containerStatus({ Status: 'exited', ExitCode: 143 }),
        'Stopped',
    );
    assert.equal(
        containerStatus({ Status: 'exited', ExitCode: 137 }),
        'Exited',
    );
    assert.equal(
        containerStatus({ Status: 'exited', ExitCode: 137, OOMKilled: false }),
        'Stopped',
    );
    assert.equal(
        containerStatus({ Status: 'exited', ExitCode: 137, OOMKilled: true }),
        'Exited',
    );
    assert.equal(containerStatus({ Status: 'exited', ExitCode: 1 }), 'Exited');
});

test('project diagnostics keep unconfirmed exit 137 visible without inventing OOM evidence', async () => {
    const directory = process.cwd();
    const statuses = await statusesForProject(directory, [
        {
            labels: {
                'com.docker.compose.service': 'api',
                'com.docker.compose.project.working_dir': directory,
            },
            state: { Status: 'exited', ExitCode: 137 },
        },
    ]);
    assert.equal(
        environmentSummary(
            { api: { enabled: 'Yes', mode: 'Service' } },
            statuses,
            'ready',
        ).state,
        'Issues',
    );
    const blockers = serviceBlockers({
        enabled: ['api'],
        statuses,
        containers: [
            {
                id: 'api-1',
                service: 'api',
                projectName: 'fixture',
                projectDirectory: directory,
                lifecycle: 'exited',
                exitCode: 137,
            },
        ],
    });
    assert.equal(blockers[0]?.state, 'failing');
    assert.match(blockers[0]!.detail, /code 137.*did not confirm an OOM/);
});

test('scopes containers by project path, ignores one-offs, and reports unhealthy replicas', async () => {
    const snapshot = (
        name: string,
        path = process.cwd(),
        health = 'healthy',
        oneoff = 'False',
    ): ContainerSnapshot => ({
        labels: {
            'com.docker.compose.service': name,
            'com.docker.compose.project.working_dir': path,
            'com.docker.compose.oneoff': oneoff,
        },
        state: { Status: 'running', Health: { Status: health } },
    });
    const result = await statusesForProject(process.cwd(), [
        snapshot('api'),
        snapshot('api', process.cwd(), 'unhealthy'),
        snapshot('unrelated', '/other-checkout'),
        snapshot('job', process.cwd(), 'healthy', 'True'),
    ]);
    assert.deepEqual(result, { api: 'Unhealthy' });
});
