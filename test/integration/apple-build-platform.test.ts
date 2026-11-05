import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    mkdtemp,
    mkdir,
    readFile,
    writeFile,
    cp,
    rm,
    realpath,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import {
    AppleRuntimeAdapter,
    appleNamespace,
} from '../../src/infrastructure/native/apple-adapter.js';
import { PortableDefinitionCompiler } from '../../src/infrastructure/native/portable-compiler.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';

test(
    'Apple builds and runs an AMD64-only base after automatic platform recovery',
    {
        skip: process.env.CHS_APPLE_INTEGRATION !== '1',
        timeout: 600000,
    },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-apple-build-platform-')),
        );
        const namespace = appleNamespace(directory);
        const image = `${namespace}/app:dev`;
        const adapter = new AppleRuntimeAdapter({
            directory,
            projectName: namespace,
            stateDirectory: join(directory, 'state'),
            execute: createProcessExecutor(),
            environment: { resolve: async () => ({ ...process.env }) },
        });
        const events: string[] = [];
        const context = {
            onOutput: (event: { text: string }) => events.push(event.text),
        };
        const tags = new Set([image]);
        try {
            let recipe = `FROM ${process.env.CHS_APPLE_BUILD_BASE_IMAGE ?? 'docker.io/amd64/alpine:3.22'}\n`;
            // Optional acceptance check against the actual CHS Node development recipe.
            const chsRoot = process.env.CHS_APPLE_CHS_BUILD_ROOT;
            if (chsRoot) {
                const relative = 'local/builders/node/v3';
                await mkdir(join(directory, 'local/builders/node'), {
                    recursive: true,
                });
                await cp(join(chsRoot, relative), join(directory, relative), {
                    recursive: true,
                });
                recipe = await readFile(
                    join(chsRoot, relative, 'dev.Dockerfile'),
                    'utf8',
                );
            }
            await writeFile(
                join(directory, 'Dockerfile'),
                recipe + '\nRUN uname -m > /build-platform\n',
            );
            const file = join(directory, 'compose.yaml');
            await writeFile(
                file,
                stringify({
                    services: {
                        app: {
                            image,
                            pull_policy: 'build',
                            build: {
                                context: directory,
                                args: { LANGUAGE_MAJOR_VERSION: '24' },
                            },
                        },
                    },
                }),
            );
            const compile = () =>
                new PortableDefinitionCompiler().compile(
                    {
                        protocolVersion: 1,
                        projectName: namespace,
                        projectDirectory: directory,
                        configurationIdentity: 'one',
                        composeFiles: [file],
                        inventory: [{ service: 'app', mode: 'Development' }],
                        environmentRequirements: [],
                    },
                    {},
                );
            const project = await compile();
            project.namespace = namespace;
            await adapter.images.prepare(project, [], context);
            const spec = project.services.app;
            assert.equal(spec.platform, 'linux/amd64');
            assert.match(
                events.join('\n'),
                /retrying build with linux\/amd64 emulation/,
            );
            tags.add(spec.imageReference!);
            const run = await adapter.client.checked(
                [
                    'run',
                    '--rm',
                    '--name',
                    namespace,
                    '--platform',
                    spec.platform,
                    '--entrypoint',
                    '/bin/sh',
                    spec.imageReference!,
                    '-c',
                    'test "$(uname -m)" = x86_64 && cat /build-platform',
                ],
                {},
                { timeout: 120000 },
            );
            assert.equal(run.stdout.trim(), 'x86_64');
            // A fresh definition on reload must make the same choice and keep its fingerprint.
            const reload = await compile();
            reload.namespace = namespace;
            await adapter.images.prepare(reload, ['app'], context);
            assert.equal(reload.services.app.platform, spec.platform);
            assert.equal(reload.services.app.imageId, spec.imageId);
            tags.add(reload.services.app.imageReference!);
        } catch (error) {
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}\n${events.join('\n')}`,
            );
        } finally {
            await adapter.client
                .run(['delete', '--force', namespace])
                .catch(() => {});
            for (const tag of tags)
                await adapter.client
                    .run(['image', 'delete', tag])
                    .catch(() => {});
            await rm(directory, { recursive: true, force: true });
        }
    },
);
