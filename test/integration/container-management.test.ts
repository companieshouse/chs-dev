import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DockerComposeStrategy } from '../../src/infrastructure/runtimes/docker-compose.js';
import { DockerNativeStrategy } from '../../src/infrastructure/runtimes/docker-native.js';
import { filterContainers } from '../../src/domain/containers.js';

const exec = promisify(execFile);
test(
    'container management lists native, Compose and unrelated containers and controls exact IDs',
    {
        skip: process.env.CHS_NATIVE_INTEGRATION !== '1',
        timeout: 120000,
    },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-container-management-')),
        );
        const suffix = directory.split('/').at(-1)!;
        const names = [
            `${suffix}-native`,
            `${suffix}-compose`,
            `${suffix}-other`,
        ];
        const docker = async (...args: string[]) =>
            (await exec('docker', args)).stdout.trim();
        const project = {
            directory,
            name: suffix,
            environment: { resolve: async () => ({ ...process.env }) },
        };
        try {
            const nativeId = await docker(
                'run',
                '--detach',
                '--name',
                names[0],
                '--stop-timeout',
                '1',
                '--label',
                `chs.dev.directory=${directory}`,
                '--label',
                'chs.dev.backend=native',
                '--label',
                'chs.dev.service=api',
                '--env',
                'TEST_PASSWORD=hidden-value',
                '--mount',
                `type=bind,src=${directory},dst=/fixture`,
                '--publish',
                '127.0.0.1::8080',
                'alpine:latest',
                'sh',
                '-c',
                'echo container-manager-ready; echo container-stderr-ready >&2; exec sleep 300',
            );
            const composeId = await docker(
                'run',
                '--detach',
                '--name',
                names[1],
                '--stop-timeout',
                '1',
                '--label',
                `com.docker.compose.project.working_dir=${directory}`,
                '--label',
                `com.docker.compose.project=${suffix}`,
                '--label',
                'com.docker.compose.service=worker',
                'alpine:latest',
                'sleep',
                '300',
            );
            const foreignId = await docker(
                'create',
                '--name',
                names[2],
                'alpine:latest',
                'sleep',
                '300',
            );
            for (const strategy of [
                new DockerComposeStrategy(),
                new DockerNativeStrategy(),
            ]) {
                const manager = strategy.containers(project);
                const list = await manager.list();
                assert.ok(list.some((c) => c.id === foreignId));
                assert.deepEqual(
                    filterContainers(list, { all: false, query: '' })
                        .map((c) => c.id)
                        .sort(),
                    [nativeId, composeId].sort(),
                );
                const details = await manager.inspect(nativeId);
                assert.equal(details.image, 'alpine:latest');
                assert.equal(details.currentProject, true);
                assert.ok(details.ports.some((p) => p.endsWith('8080/tcp')));
                assert.ok(details.mounts.some((m) => m.target === '/fixture'));
                assert.ok(details.networks.some((n) => n.name === 'bridge'));
                assert.doesNotMatch(
                    JSON.stringify(details.inspection),
                    /hidden-value/,
                );
                assert.ok(
                    (await manager.logs(nativeId, 20)).some((line) =>
                        line.includes('container-manager-ready'),
                    ),
                );
                assert.ok(
                    (await manager.logs(nativeId, 20)).some((line) =>
                        line.includes('container-stderr-ready'),
                    ),
                );
                await manager.action('stop', details, {});
                assert.equal((await manager.inspect(nativeId)).state, 'exited');
                await manager.action('start', details, {});
                assert.equal(
                    (await manager.inspect(nativeId)).state,
                    'running',
                );
                await manager.action('restart', details, {});
                assert.equal(
                    (await manager.inspect(nativeId)).state,
                    'running',
                );
            }
            const manager = new DockerComposeStrategy().containers(project);
            const selected = await manager.inspect(nativeId);
            await docker('rm', '--force', nativeId);
            const replacement = await docker(
                'run',
                '--detach',
                '--name',
                names[0],
                '--stop-timeout',
                '1',
                'alpine:latest',
                'sleep',
                '300',
            );
            await assert.rejects(
                manager.action('stop', selected, {}),
                /No such (?:object|container)/i,
            );
            assert.equal((await manager.inspect(replacement)).state, 'running');
        } finally {
            for (const name of names)
                await docker('rm', '--force', name).catch(() => {});
            await rm(directory, { recursive: true, force: true });
        }
    },
);
