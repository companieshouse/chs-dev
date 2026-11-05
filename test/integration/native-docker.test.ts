import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { stringify } from 'yaml';
import { NativeDockerRuntime } from '../../src/infrastructure/native/runtime.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import { namespace } from '../../src/infrastructure/native/compiler.js';
import type { PreparedProject } from '../../src/domain/live.js';
const exec = promisify(execFile);

test(
    'native Docker reconciles a dependency stack and preserves isolated data',
    { skip: process.env.CHS_NATIVE_INTEGRATION !== '1', timeout: 180000 },
    async (t) => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-native-integration-')),
        );
        const ns = namespace(directory);
        const file = join(directory, 'compose.yaml');
        const image = process.env.CHS_NATIVE_TEST_IMAGE ?? 'alpine:latest';
        const definition: any = {
            services: {
                db: {
                    image,
                    pull_policy: 'never',
                    stop_grace_period: '1s',
                    command: [
                        'sh',
                        '-c',
                        'echo ready > /data/ready; exec sleep 3600',
                    ],
                    volumes: ['data:/data'],
                    healthcheck: {
                        test: ['CMD', 'test', '-f', '/data/ready'],
                        interval: '1s',
                        timeout: '1s',
                        retries: 3,
                    },
                },
                seed: {
                    image,
                    pull_policy: 'never',
                    stop_grace_period: '1s',
                    command: ['sh', '-c', 'echo seeded > /data/value'],
                    volumes: ['data:/data'],
                    depends_on: { db: { condition: 'service_healthy' } },
                },
                app: {
                    extra_hosts: [
                        'account.chs.local=host-gateway',
                        'legacy.chs.local:127.0.0.1',
                        'ipv6.chs.local=[::1]',
                    ],
                    image,
                    pull_policy: 'never',
                    stop_grace_period: '1s',
                    command: ['sh', '-c', 'cat /data/value; exec sleep 3600'],
                    volumes: ['data:/data:ro'],
                    depends_on: {
                        seed: { condition: 'service_completed_successfully' },
                        db: { condition: 'service_healthy', restart: true },
                    },
                },
            },
            volumes: { data: {} },
        };
        const save = () => writeFile(file, stringify(definition));
        await save();
        const project: PreparedProject = {
            protocolVersion: 1,
            projectName: `test-${ns}`,
            projectDirectory: directory,
            configurationIdentity: 'one',
            composeFiles: [file],
            inventory: ['db', 'seed', 'app'].map((service) => ({
                service,
                mode: 'Service',
            })),
            environmentRequirements: [],
        };
        const runtime = new NativeDockerRuntime({
            directory,
            projectName: project.projectName,
            stateDirectory: join(directory, 'state'),
            execute: createProcessExecutor(),
            environment: { resolve: async () => ({ ...process.env }) },
            policy: { pollMs: 100, readinessMs: 15000, jobMs: 15000 },
        });
        const output: string[] = [];
        const context = { onOutput: (e: any) => output.push(e.text) };
        const docker = async (...args: string[]) =>
            (await exec('docker', args)).stdout.trim();
        try {
            assert.equal((await runtime.checkAvailability()).available, true);
            await runtime.apply(project, context);
            const first = await runtime.snapshot();
            const appId = first.containers.find((c) => c.service === 'app')!.id;
            const appDetail = JSON.parse(await docker('inspect', appId))[0];
            assert.equal(appDetail.Name, '/app');
            const group = appDetail.Config.Labels['com.docker.compose.project'];
            assert.equal(
                appDetail.Config.Labels['com.docker.compose.service'],
                'app',
            );
            assert.notEqual(group, project.projectName);
            const grouped = await docker(
                'ps',
                '--all',
                '--quiet',
                '--filter',
                `label=com.docker.compose.project=${group}`,
            );
            assert.equal(grouped.split('\n').length, 3);
            // Presentation labels must not make Compose adopt the native containers.
            const composeVisible = JSON.parse(
                (await docker(
                    'compose',
                    '-p',
                    group,
                    '-f',
                    file,
                    'ps',
                    '--all',
                    '--format',
                    'json',
                )) || '[]',
            );
            assert.deepEqual(composeVisible, []);
            const hosts = await docker('exec', appId, 'cat', '/etc/hosts');
            assert.match(hosts, /\d+\.\d+\.\d+\.\d+\s+account\.chs\.local/);
            assert.match(hosts, /127\.0\.0\.1\s+legacy\.chs\.local/);
            assert.match(hosts, /::1\s+ipv6\.chs\.local/);
            await docker(
                'exec',
                first.containers.find((c) => c.service === 'db')!.id,
                'touch',
                '/data/native-only',
            );
            assert.equal(first.containers.length, 3);
            assert.equal(
                first.containers.find((c) => c.service === 'seed')?.exitCode,
                0,
            );
            assert.ok(
                (
                    await runtime.logs(
                        first.containers.find((c) => c.service === 'app')!,
                        { tail: 10 },
                    )
                ).some((l) => l.includes('seeded')),
            );
            await runtime.apply(project, context);
            assert.deepEqual(
                (await runtime.snapshot()).containers.map((c) => c.id).sort(),
                first.containers.map((c) => c.id).sort(),
            );
            definition.services.app.environment = { REVISION: 'two' };
            await save();
            await runtime.apply(project, context);
            const changed = await runtime.snapshot();
            assert.notEqual(
                changed.containers.find((c) => c.service === 'app')?.id,
                first.containers.find((c) => c.service === 'app')?.id,
            );
            assert.equal(
                changed.containers.find((c) => c.service === 'db')?.id,
                first.containers.find((c) => c.service === 'db')?.id,
            );
            await runtime.containerAction(
                'stop',
                changed.containers.filter((c) => c.service === 'app'),
                context,
            );
            assert.equal(
                (await runtime.snapshot()).containers.find(
                    (c) => c.service === 'app',
                )?.lifecycle,
                'exited',
            );
            await runtime.apply(project, context);
            assert.equal(
                (await runtime.snapshot()).containers.find(
                    (c) => c.service === 'app',
                )?.lifecycle,
                'running',
            );
            const controller = new AbortController();
            controller.abort();
            await assert.rejects(
                runtime.apply(project, { signal: controller.signal }),
            );
            await runtime.apply(project, context);
            const stopOutputStart = output.length;
            await runtime.stopProject(context);
            const stopOutput = output.slice(stopOutputStart);
            assert.ok(
                stopOutput.some((line) => line.startsWith('Stopping: app')),
            );
            assert.ok(
                stopOutput.some((line) => line.startsWith('Removing: seed')),
            );
            assert.ok(
                stopOutput.some((line) => line.startsWith('Removed: db [3/3]')),
            );
            assert.equal((await runtime.snapshot()).containers.length, 0);
            await docker('volume', 'inspect', `${ns}-data`);
            await runtime.apply(project, context);
            assert.ok(
                (
                    await runtime.logs(
                        (await runtime.snapshot()).containers.find(
                            (c) => c.service === 'app',
                        )!,
                        { tail: 10 },
                    )
                ).some((l) => l.includes('seeded')),
            );
            await runtime.stopProject(context);
            await docker(
                'compose',
                '--project-name',
                project.projectName,
                '--project-directory',
                directory,
                '-f',
                file,
                'up',
                '--detach',
            );
            await assert.rejects(
                runtime.apply(project, context),
                /Compose containers still exist/,
            );
            const composeDb = await docker(
                'compose',
                '--project-name',
                project.projectName,
                '--project-directory',
                directory,
                '-f',
                file,
                'ps',
                '--quiet',
                'db',
            );
            await docker(
                'exec',
                composeDb,
                'test',
                '!',
                '-e',
                '/data/native-only',
            );
            await docker('exec', composeDb, 'touch', '/data/compose-only');
            await docker(
                'compose',
                '--project-name',
                project.projectName,
                '--project-directory',
                directory,
                '-f',
                file,
                'down',
            );
            await runtime.apply(project, context);
            const nativeDb = (await runtime.snapshot()).containers.find(
                (c) => c.service === 'db',
            )!.id;
            await docker('exec', nativeDb, 'test', '-e', '/data/native-only');
            await docker(
                'exec',
                nativeDb,
                'test',
                '!',
                '-e',
                '/data/compose-only',
            );
            assert.ok(output.some((l) => l.startsWith('keep:')));
        } finally {
            await runtime.stopProject({}).catch(() => {});
            await docker(
                'compose',
                '--project-name',
                project.projectName,
                '--project-directory',
                directory,
                '-f',
                file,
                'down',
                '--volumes',
            ).catch(() => {});
            for (const kind of ['network', 'volume']) {
                const ids = await docker(
                    kind,
                    'ls',
                    '--quiet',
                    '--filter',
                    `label=chs.dev.project=${ns}`,
                ).catch(() => '');
                if (ids) await docker(kind, 'rm', ...ids.split('\n'));
            }
            await rm(directory, { recursive: true, force: true });
        }
    },
);
