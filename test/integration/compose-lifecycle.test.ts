import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { stringify } from 'yaml';
import { ComposeBackend } from '../../src/infrastructure/runtimes/compose-backend.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import type {
    PreparedProject,
    RuntimeContainer,
} from '../../src/domain/live.js';

const exec = promisify(execFile);
const docker = async (...args: string[]) =>
    (await exec('docker', args)).stdout.trim();

async function ready(runtime: ComposeBackend): Promise<RuntimeContainer[]> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const { containers } = await runtime.snapshot();
        if (
            containers.some(
                (c) => c.service === 'app' && c.lifecycle === 'running',
            ) &&
            containers.some((c) => c.service === 'seed' && c.exitCode === 0)
        )
            return containers;
        await delay(200);
    }
    throw new Error('Compose stack did not become ready.');
}

test(
    'Compose owns dependency/job startup, reload, exact-ID actions, lazy creation and volume-preserving stop',
    {
        skip: process.env.CHS_DOCKER_INTEGRATION !== '1',
        timeout: 180000,
    },
    async (t) => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-compose-integration-')),
        );
        const name = directory.split('/').at(-1)!.toLowerCase();
        const image = process.env.CHS_DOCKER_TEST_IMAGE ?? 'alpine:latest';
        const file = join(directory, 'compose.yaml');
        const definition = {
            services: {
                db: {
                    image,
                    command: ['sh', '-c', 'touch /data/ready; exec sleep 300'],
                    volumes: ['data:/data'],
                    healthcheck: {
                        test: ['CMD', 'test', '-f', '/data/ready'],
                        interval: '1s',
                        timeout: '1s',
                        retries: 10,
                    },
                },
                seed: {
                    image,
                    command: ['sh', '-c', 'echo seeded > /data/value'],
                    volumes: ['data:/data'],
                    depends_on: { db: { condition: 'service_healthy' } },
                },
                app: {
                    image,
                    command: ['sh', '-c', 'cat /data/value; exec sleep 300'],
                    volumes: ['data:/data:ro'],
                    depends_on: {
                        seed: { condition: 'service_completed_successfully' },
                    },
                },
            },
            volumes: { data: { name: `${name}-data` } },
        };
        await writeFile(file, stringify(definition));
        const project: PreparedProject = {
            protocolVersion: 1,
            projectName: name,
            projectDirectory: directory,
            configurationIdentity: 'test',
            composeFiles: [file],
            environmentRequirements: [],
            inventory: ['db', 'seed', 'app'].map((service) => ({
                service,
                mode: 'Service',
            })),
        };
        const runtime = new ComposeBackend(
            {
                directory,
                projectName: name,
                realpath,
                execute: createProcessExecutor(),
                environment: { resolve: async () => ({ ...process.env }) },
            },
            join(directory, 'state'),
        );
        const foreignName = `${name}-foreign`;
        t.after(async () => {
            await docker('rm', '--force', foreignName).catch(() => {});
            await docker(
                'compose',
                '-p',
                name,
                '-f',
                file,
                'down',
                '--volumes',
            );
            await rm(directory, { recursive: true, force: true });
        });
        await docker(
            'run',
            '--detach',
            '--name',
            foreignName,
            image,
            'sleep',
            '300',
        );
        await runtime.apply(project, {});
        const first = await ready(runtime);
        const app = first.find((c) => c.service === 'app')!;
        assert.ok(
            (await runtime.logs(app, { tail: 10 })).some((line) =>
                line.includes('seeded'),
            ),
        );
        await runtime.apply(project, {});
        const second = await ready(runtime);
        assert.deepEqual(
            second.map((c) => c.id).sort(),
            first.map((c) => c.id).sort(),
        );
        await runtime.reload(project, ['app'], {});
        const reloaded = await ready(runtime);
        const currentApp = reloaded.find((c) => c.service === 'app')!;
        assert.notEqual(currentApp.id, app.id);
        assert.equal(
            reloaded.find((c) => c.service === 'db')!.id,
            first.find((c) => c.service === 'db')!.id,
        );
        await runtime.containerAction('stop', [currentApp], {});
        assert.equal(
            (await runtime.snapshot()).containers.find(
                (c) => c.service === 'app',
            )!.lifecycle,
            'exited',
        );
        await runtime.containerAction('start', [currentApp], {});
        await ready(runtime);
        await runtime.stopProject({});
        assert.deepEqual((await runtime.snapshot()).containers, []);
        assert.equal(
            await docker(
                'inspect',
                '--format',
                '{{.State.Running}}',
                foreignName,
            ),
            'true',
        );
        await docker('volume', 'inspect', `${name}-data`);
        assert.equal(
            await docker(
                'run',
                '--rm',
                '--volume',
                `${name}-data:/data:ro`,
                image,
                'cat',
                '/data/value',
            ),
            'seeded',
        );
        const lazyProject = {
            ...project,
            inventory: project.inventory.map((item) => ({
                ...item,
                lazy: item.service === 'app',
            })),
        };
        await runtime.apply(lazyProject, {});
        assert.equal(
            (await runtime.snapshot()).containers.find(
                (c) => c.service === 'app',
            )!.lifecycle,
            'created',
        );
        await runtime.stopProject({});
    },
);
