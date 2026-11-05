import assert from 'node:assert/strict';
import { test } from 'node:test';
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
        'Stopped',
    );
    assert.equal(
        containerStatus({ Status: 'exited', ExitCode: 137, OOMKilled: true }),
        'Exited',
    );
    assert.equal(containerStatus({ Status: 'exited', ExitCode: 1 }), 'Exited');
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
