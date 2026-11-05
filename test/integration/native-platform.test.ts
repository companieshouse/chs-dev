import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stringify } from 'yaml';
import { NativeDockerRuntime } from '../../src/infrastructure/native/runtime.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import { namespace } from '../../src/infrastructure/native/compiler.js';
const exec = promisify(execFile);
test(
    'explicit amd64 image selection works on the selected local engine',
    {
        skip: process.env.CHS_NATIVE_PLATFORM_INTEGRATION !== '1',
        timeout: 120000,
    },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-native-platform-')),
        );
        const file = join(directory, 'compose.yaml');
        const ns = namespace(directory);
        await writeFile(
            file,
            stringify({
                services: {
                    app: {
                        image: 'alpine:3.22',
                        platform: 'linux/amd64',
                        pull_policy: 'always',
                        command: ['sleep', '300'],
                        stop_grace_period: '1s',
                    },
                },
            }),
        );
        const runtime = new NativeDockerRuntime({
            directory,
            projectName: ns,
            stateDirectory: join(directory, 'state'),
            execute: createProcessExecutor(),
            environment: { resolve: async () => ({ ...process.env }) },
        });
        try {
            await runtime.apply(
                {
                    protocolVersion: 1,
                    projectName: ns,
                    projectDirectory: directory,
                    configurationIdentity: 'one',
                    composeFiles: [file],
                    inventory: [{ service: 'app', mode: 'Service' }],
                    environmentRequirements: [],
                },
                {},
            );
            const id = (await runtime.snapshot()).containers[0].id;
            assert.equal(
                (
                    await exec('docker', ['exec', id, 'uname', '-m'])
                ).stdout.trim(),
                'x86_64',
            );
        } finally {
            await runtime.stopProject({}).catch(() => {});
            const ids = (
                await exec('docker', [
                    'network',
                    'ls',
                    '--quiet',
                    '--filter',
                    `label=chs.dev.project=${ns}`,
                ])
            ).stdout.trim();
            if (ids)
                await exec('docker', ['network', 'rm', ...ids.split('\n')]);
            await rm(directory, { recursive: true, force: true });
        }
    },
);
