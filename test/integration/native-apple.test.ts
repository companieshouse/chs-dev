import { cleanupAppleFixture } from './apple-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { AppleNativeStrategy } from '../../src/infrastructure/runtimes/apple-native.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import type { PreparedProject } from '../../src/domain/live.js';

test(
    'Apple native runs DNS, dependencies, jobs, lifecycle and retained volumes without Docker',
    { skip: process.env.CHS_APPLE_INTEGRATION !== '1', timeout: 240000 },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-apple-')),
        );
        const strategy = new AppleNativeStrategy();
        const project = {
            directory,
            name: 'apple-fixture',
            environment: { resolve: async () => ({ ...process.env }) },
        };
        const runtime = strategy.live(project),
            manager = strategy.containers(project);
        const file = join(directory, 'compose.yaml');
        const prepared: PreparedProject = {
            protocolVersion: 1,
            projectName: project.name,
            projectDirectory: directory,
            configurationIdentity: 'fixture',
            composeFiles: [file],
            inventory: [],
            environmentRequirements: [],
        };
        const execute = createProcessExecutor();
        const context = {
            onOutput: (e: { text: string }) =>
                process.stdout.write(e.text + '\n'),
        };
        try {
            assert.equal((await runtime.checkAvailability()).available, true);
            await writeFile(
                file,
                stringify({
                    services: {
                        'apple-db': {
                            image: 'alpine:3.22',
                            command: [
                                'sh',
                                '-c',
                                'touch /data/retained; exec sleep 3600',
                            ],
                            stop_grace_period: '1s',
                            volumes: ['data:/data'],
                            networks: ['chs'],
                            healthcheck: {
                                test: ['CMD', 'test', '-f', '/data/retained'],
                                interval: '1s',
                                timeout: '2s',
                            },
                        },
                        'apple-seed': {
                            image: 'alpine:3.22',
                            command: [
                                'sh',
                                '-c',
                                'nslookup apple-db && echo job-finished',
                            ],
                            networks: ['chs'],
                            depends_on: {
                                'apple-db': { condition: 'service_healthy' },
                            },
                        },
                        'apple-app': {
                            image: 'alpine:3.22',
                            command: [
                                'sh',
                                '-c',
                                'echo application-ready; exec sleep 3600',
                            ],
                            stop_grace_period: '1s',
                            networks: ['chs'],
                            depends_on: {
                                'apple-seed': {
                                    condition: 'service_completed_successfully',
                                },
                            },
                        },
                    },
                    networks: { chs: {} },
                    volumes: { data: {} },
                }),
            );
            await runtime.apply(prepared, context);
            const initial = await manager.list();
            const run = async (args: string[]) =>
                execute({
                    command: process.env.CHS_DEV_APPLE_CLI ?? 'container',
                    args,
                    cwd: directory,
                    env: process.env,
                    privateOutput: true,
                });
            assert.equal(
                (
                    await run([
                        'exec',
                        'apple-db',
                        'sh',
                        '-c',
                        'echo persisted > /data/user-data',
                    ])
                ).code,
                0,
            );
            const dns = initial.find((c) => c.name === 'chs-dns')!;
            const beforeDns = (await manager.inspect(dns.id)).networks;
            await manager.action('restart', dns, context);
            assert.equal(
                (await manager.inspect(dns.id)).networks[0].addresses[1],
                beforeDns[0].addresses[1],
            );
            assert.equal(
                (await run(['exec', 'apple-db', 'nslookup', 'apple-app'])).code,
                0,
            );
            const app = initial.find((c) => c.name === 'apple-app')!;
            assert.ok(app.currentProject);
            assert.ok(app.incarnation);
            assert.ok(
                (await manager.logs(app.id, 200)).some((l) =>
                    l.includes('application-ready'),
                ),
            );
            assert.equal(
                (await runtime.snapshot()).containers.find(
                    (c) => c.service === 'apple-seed',
                )?.exitCode,
                0,
            );
            await runtime.apply(prepared, context);
            assert.equal(
                (await manager.inspect(app.id)).incarnation,
                app.incarnation,
            );
            await manager.action('stop', app, context);
            await runtime.monitor({});
            assert.equal((await manager.inspect(app.id)).state, 'exited');
            await manager.action('start', app, context);
            await runtime.stopProject(context);
            assert.equal(
                (await manager.list()).filter((c) => c.currentProject).length,
                0,
            );
            await runtime.apply(prepared, context);
            await assert.rejects(
                manager.action('stop', app, context),
                /changed/,
            );
            const result = await execute({
                command: process.env.CHS_DEV_APPLE_CLI ?? 'container',
                args: ['exec', 'apple-db', 'test', '-f', '/data/retained'],
                cwd: directory,
                env: process.env,
                privateOutput: true,
            });
            assert.equal(result.code, 0);
            assert.equal(
                (
                    await run(['exec', 'apple-db', 'cat', '/data/user-data'])
                ).stdout.trim(),
                'persisted',
            );
        } catch (error) {
            for (const c of await manager.list().catch(() => [])) {
                if (c.currentProject)
                    console.error(
                        c.name,
                        await manager.logs(c.id, 30).catch(String),
                    );
            }
            throw error;
        } finally {
            await cleanupAppleFixture(runtime, directory);
            await rm(directory, { recursive: true, force: true });
        }
    },
);
