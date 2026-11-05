import { cleanupAppleFixture } from './apple-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { stringify } from 'yaml';
import { AppleNativeStrategy } from '../../src/infrastructure/runtimes/apple-native.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import type { PreparedProject } from '../../src/domain/live.js';

test(
    'Apple inherits image health and volume defaults, preserves data and publishes monitoring targets',
    { skip: process.env.CHS_APPLE_INTEGRATION !== '1', timeout: 600000 },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-apple-monitoring-')),
        );
        const strategy = new AppleNativeStrategy(),
            project = {
                directory,
                name: 'apple-monitoring',
                environment: { resolve: async () => ({ ...process.env }) },
            };
        const runtime = strategy.live(project),
            manager = strategy.containers(project),
            execute = createProcessExecutor();
        const file = join(directory, 'compose.yaml'),
            prepared: PreparedProject = {
                protocolVersion: 1,
                projectName: project.name,
                projectDirectory: directory,
                configurationIdentity: 'fixture',
                composeFiles: [file],
                inventory: [],
                environmentRequirements: [],
            };
        const command = async (args: string[]) => {
            const result = await execute({
                command: process.env.CHS_DEV_APPLE_CLI ?? 'container',
                args,
                cwd: directory,
                env: process.env,
                privateOutput: true,
                captureStderr: true,
            });
            assert.equal(result.code, 0, result.stderr);
            return result.stdout;
        };
        const context = {
            onOutput: (e: { text: string }) =>
                process.stdout.write(e.text + '\n'),
        };
        try {
            await writeFile(
                join(directory, 'Dockerfile'),
                'FROM busybox:1.37\nRUN mkdir -p /data /anonymous /www && echo original > /data/seed && echo anonymous > /anonymous/seed && echo "fixture_metric 1" > /www/metrics.txt\nVOLUME ["/data", "/anonymous"]\nHEALTHCHECK --interval=1s --timeout=2s CMD wget -qO- http://127.0.0.1:8080/metrics.txt\nCMD ["busybox", "httpd", "-f", "-p", "8080", "-h", "/www"]\n',
            );
            await writeFile(
                join(directory, 'prometheus.yaml'),
                stringify({
                    global: { scrape_interval: '1s' },
                    scrape_configs: [
                        {
                            job_name: 'containers',
                            metrics_path: '/metrics.txt',
                            docker_sd_configs: [
                                { host: 'unix:///var/run/docker.sock' },
                            ],
                        },
                    ],
                }),
            );
            await writeFile(
                file,
                stringify({
                    services: {
                        'metrics-app': {
                            build: directory,
                            expose: ['8080'],
                            volumes: ['data:/data'],
                            networks: ['chs'],
                            stop_grace_period: '1s',
                        },
                        prometheus: {
                            image: 'prom/prometheus:v3.5.0',
                            user: 'root',
                            command: ['--config.file=/etc/prometheus.yaml'],
                            volumes: [
                                './prometheus.yaml:/etc/prometheus.yaml:ro',
                                '/var/run/docker.sock:/var/run/docker.sock:ro',
                            ],
                            networks: ['chs'],
                            stop_grace_period: '1s',
                        },
                        'metrics-probe': {
                            image: 'alpine:3.22',
                            command: ['sleep', '3600'],
                            networks: ['chs'],
                            stop_grace_period: '1s',
                        },
                    },
                    networks: { chs: {} },
                    volumes: { data: {} },
                }),
            );
            await runtime.apply(prepared, context);
            assert.equal(
                (await runtime.snapshot()).containers.find(
                    (c) => c.service === 'metrics-app',
                )?.health,
                'healthy',
            );
            assert.equal(
                (
                    await command(['exec', 'metrics-app', 'cat', '/data/seed'])
                ).trim(),
                'original',
            );
            assert.equal(
                (
                    await command([
                        'exec',
                        'metrics-app',
                        'cat',
                        '/anonymous/seed',
                    ])
                ).trim(),
                'anonymous',
            );
            await command([
                'exec',
                'metrics-app',
                'sh',
                '-c',
                'echo retained > /data/user-data; echo retained > /anonymous/user-data',
            ]);
            let up = false;
            for (let i = 0; i < 30; i++) {
                const response = JSON.parse(
                    await command([
                        'exec',
                        'metrics-probe',
                        'wget',
                        '-qO-',
                        'http://prometheus:9090/api/v1/targets',
                    ]),
                );
                up = response.data.activeTargets.some(
                    (v: any) =>
                        v.labels.chs_service === 'metrics-app' &&
                        v.health === 'up',
                );
                if (up) break;
                await delay(1000);
            }
            assert.ok(
                up,
                'Prometheus must discover and scrape the application',
            );
            await runtime.stopProject(context);
            await runtime.apply(prepared, context);
            assert.equal(
                (
                    await command([
                        'exec',
                        'metrics-app',
                        'cat',
                        '/data/user-data',
                    ])
                ).trim(),
                'retained',
            );
            assert.equal(
                (
                    await command([
                        'exec',
                        'metrics-app',
                        'cat',
                        '/anonymous/user-data',
                    ])
                ).trim(),
                'retained',
            );
        } catch (error) {
            for (const c of await manager.list().catch(() => []))
                if (c.currentProject)
                    console.error(
                        c.name,
                        await manager.logs(c.id, 20).catch(String),
                    );
            throw error;
        } finally {
            await cleanupAppleFixture(runtime, directory);
            await rm(directory, { recursive: true, force: true });
        }
    },
);
