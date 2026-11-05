import { cleanupAppleFixture } from './apple-fixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    mkdtemp,
    writeFile,
    readFile,
    mkdir,
    rm,
    realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { stringify } from 'yaml';
import { AppleNativeStrategy } from '../../src/infrastructure/runtimes/apple-native.js';
import { projectStateDirectory } from '../../src/infrastructure/settings.js';
import { NativeDockerRuntime } from '../../src/infrastructure/native/runtime.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import { namespace } from '../../src/infrastructure/native/compiler.js';
import type { PreparedProject } from '../../src/domain/live.js';
const exec = promisify(execFile);
const apple = process.env.CHS_APPLE_INTEGRATION === '1';

test(
    'native builds, Java builder jobs, Node source mounts, secrets and reload',
    {
        skip: !apple && process.env.CHS_NATIVE_INTEGRATION !== '1',
        timeout: 600000,
    },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-native-development-')),
        );
        const ns = namespace(directory);
        const file = join(directory, 'compose.yaml');
        const javaImage =
            process.env.CHS_NATIVE_JAVA_IMAGE ?? 'maven:3.9-eclipse-temurin-21';
        const nodeImage =
            process.env.CHS_NATIVE_NODE_IMAGE ?? 'node:24-bookworm';
        await mkdir(join(directory, 'java'));
        await mkdir(join(directory, 'node'));
        await writeFile(
            join(directory, 'java', 'Main.java'),
            'public class Main { public static void main(String[] args) throws Exception { System.out.println("java-v1"); Thread.sleep(3600000); } }',
        );
        await writeFile(
            join(directory, 'node', 'app.js'),
            'console.log("node-v1");setInterval(()=>{},1000);',
        );
        await writeFile(
            join(directory, 'Node.Dockerfile'),
            `FROM ${nodeImage}\nCOPY version /version\n`,
        );
        await writeFile(join(directory, 'version'), 'one');
        await writeFile(join(directory, 'secret'), 'fixture-secret');
        const labels = (owner: string) => ({
            'chs.dev.mode': 'Development',
            'chs.dev.owner-service': owner,
        });
        const definition: any = {
            services: {
                'java-builder': {
                    image: javaImage,
                    pull_policy: apple ? 'missing' : 'never',
                    labels: labels('java'),
                    command: ['javac', '-d', '/out', '/source/Main.java'],
                    volumes: ['./java:/source:ro', './out:/out'],
                },
                java: {
                    image: javaImage,
                    pull_policy: apple ? 'missing' : 'never',
                    labels: labels('java'),
                    command: ['java', '-cp', '/out', 'Main'],
                    volumes: ['./out:/out:ro'],
                    depends_on: {
                        'java-builder': {
                            condition: 'service_completed_successfully',
                            restart: true,
                        },
                    },
                    stop_grace_period: '1s',
                },
                node: {
                    build: {
                        context: directory,
                        dockerfile: 'Node.Dockerfile',
                    },
                    pull_policy: 'build',
                    labels: labels('node'),
                    command: ['node', '/source/app.js'],
                    volumes: ['./node:/source'],
                    secrets: ['test-key'],
                    stop_grace_period: '1s',
                },
            },
            secrets: { 'test-key': { file: './secret' } },
        };
        await writeFile(file, stringify(definition));
        const project: PreparedProject = {
            protocolVersion: 1,
            projectName: `test-${ns}`,
            projectDirectory: directory,
            configurationIdentity: 'one',
            composeFiles: [file],
            inventory: ['java', 'node'].map((service) => ({
                service,
                mode: 'Development',
            })),
            environmentRequirements: [],
        };
        const runtime = apple
            ? new AppleNativeStrategy().live({
                  directory,
                  name: project.projectName,
                  environment: { resolve: async () => ({ ...process.env }) },
              })
            : new NativeDockerRuntime({
                  directory,
                  projectName: project.projectName,
                  stateDirectory: join(directory, 'state'),
                  execute: createProcessExecutor(),
                  environment: { resolve: async () => ({ ...process.env }) },
                  policy: { pollMs: 100, readinessMs: 20000, jobMs: 30000 },
              });
        const docker = async (...args: string[]) =>
            (
                await exec(
                    apple
                        ? (process.env.CHS_DEV_APPLE_CLI ?? 'container')
                        : 'docker',
                    args,
                )
            ).stdout.trim();
        const logs = async (service: string) =>
            runtime.logs(
                (await runtime.snapshot()).containers.find(
                    (c) => c.service === service,
                )!,
                { tail: 30 },
            );
        const events: string[] = [];
        const context = { onOutput: (e: any) => events.push(e.text) };
        try {
            await runtime.apply(project, context);
            const first = await runtime.snapshot();
            await new Promise((r) => {
                setTimeout(r, 300);
            });
            assert.ok((await logs('java')).some((l) => l.includes('java-v1')));
            assert.ok((await logs('node')).some((l) => l.includes('node-v1')));
            const node = first.containers.find((c) => c.service === 'node')!;
            assert.equal(
                await docker('exec', node.id, 'cat', '/run/secrets/test-key'),
                'fixture-secret',
            );
            await runtime.apply(project, context);
            assert.deepEqual(
                (await runtime.snapshot()).containers.map((c) => c.id).sort(),
                first.containers.map((c) => c.id).sort(),
                events.join('\n'),
            );
            await writeFile(
                join(directory, 'java', 'Main.java'),
                'public class Main { public static void main(String[] args) throws Exception { System.out.println("java-v2"); Thread.sleep(3600000); } }',
            );
            await runtime.reload(project, ['java'], {});
            await new Promise((r) => {
                setTimeout(r, 300);
            });
            assert.ok((await logs('java')).some((l) => l.includes('java-v2')));
            assert.equal(
                (await runtime.snapshot()).containers.find(
                    (c) => c.service === 'node',
                )?.id,
                node.id,
            );
            await writeFile(
                join(directory, 'node', 'app.js'),
                'console.log("node-v2");setInterval(()=>{},1000);',
            );
            await writeFile(join(directory, 'version'), 'two');
            await runtime.reload(project, ['node'], {});
            await new Promise((r) => {
                setTimeout(r, 300);
            });
            assert.ok((await logs('node')).some((l) => l.includes('node-v2')));
            const journal = await readFile(
                apple
                    ? join(
                          projectStateDirectory(directory),
                          'native-apple',
                          'journal.jsonl',
                      )
                    : join(directory, 'state', 'native', 'journal.jsonl'),
                'utf8',
            );
            assert.ok(!journal.includes('fixture-secret'));
        } finally {
            await runtime.stopProject({}).catch(() => {});
            if (apple) await cleanupAppleFixture(runtime, directory);
            else await runtime.close?.();
            if (!apple)
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
            if (!apple)
                await docker('image', 'rm', `${ns}/node:dev`).catch(() => {});
            await rm(directory, { recursive: true, force: true });
        }
    },
);
