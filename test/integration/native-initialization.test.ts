import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
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
    'native Mongo initialization tolerates duplicate seeds, starts dependents and retains checkpoints',
    { skip: process.env.CHS_NATIVE_INTEGRATION !== '1', timeout: 120000 },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-native-initialization-')),
        );
        const ns = namespace(directory);
        const mongo = `${ns}-mongo`;
        const dependent = `${ns}-dependent`;
        const job = 'execute-mongo-scripts';
        const image = 'mongo:8.2.5-noble';
        const file = join(directory, 'compose.yaml');
        const scripts = join(directory, 'scripts');
        const volumes = [
            'data',
            'config',
            'dependent-data',
            'dependent-config',
        ];
        const project: PreparedProject = {
            protocolVersion: 1,
            projectName: ns,
            projectDirectory: directory,
            configurationIdentity: 'one',
            composeFiles: [file],
            inventory: [mongo, job, dependent].map((service) => ({
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
            policy: { pollMs: 100, readinessMs: 30000, jobMs: 30000 },
        });
        const docker = async (...args: string[]) =>
            (await exec('docker', args, { timeout: 30000 })).stdout.trim();
        try {
            await mkdir(scripts);
            for (const [name, script] of [
                [
                    '01.seed.mongo.js',
                    "db.values.insertOne({_id:'seed', value:'keep-me'});",
                ],
                [
                    '02.duplicate.mongo.js',
                    "db.values.insertMany([{_id:'seed',value:'must-not-replace'}]);",
                ],
                [
                    '03.after.mongo.js',
                    "db.values.updateOne({_id:'after'},{$inc:{runs:1}},{upsert:true});",
                ],
            ])
                await writeFile(
                    join(scripts, name),
                    `db = db.getSiblingDB('fixture'); ${script}`,
                );
            await writeFile(
                file,
                stringify({
                    services: {
                        [mongo]: {
                            image,
                            pull_policy: 'never',
                            volumes: ['data:/data/db', 'config:/data/configdb'],
                            networks: ['chs'],
                            healthcheck: {
                                test: [
                                    'CMD',
                                    'mongosh',
                                    '--quiet',
                                    '--eval',
                                    'quit(db.adminCommand({ping:1}).ok ? 0 : 1)',
                                ],
                                interval: '1s',
                                timeout: '5s',
                                retries: 10,
                            },
                            stop_grace_period: '1s',
                        },
                        [job]: {
                            image,
                            environment: {
                                SCRIPT_CONTAINER_NAME: mongo,
                                SCRIPT_SUFFIX: 'mongo',
                                SCRIPT_EXTENSION: 'js',
                            },
                            volumes: ['./scripts:/app/scripts'],
                            networks: ['chs'],
                            depends_on: {
                                [mongo]: { condition: 'service_healthy' },
                            },
                        },
                        [dependent]: {
                            image,
                            pull_policy: 'never',
                            entrypoint: ['sleep'],
                            command: ['300'],
                            volumes: [
                                'dependent-data:/data/db',
                                'dependent-config:/data/configdb',
                            ],
                            networks: ['chs'],
                            depends_on: {
                                [job]: {
                                    condition: 'service_completed_successfully',
                                },
                            },
                            stop_grace_period: '1s',
                        },
                    },
                    networks: { chs: {} },
                    volumes: Object.fromEntries(
                        volumes.map((name) => [name, {}]),
                    ),
                }),
            );
            const output: string[] = [];
            const context = {
                onOutput: (entry: { text: string }) => output.push(entry.text),
            };
            assert.equal(
                (await runtime.apply(project, context)).outcome,
                'success',
            );
            const check = async () => {
                const snapshot = await runtime.snapshot();
                assert.equal(
                    snapshot.containers.find((c) => c.service === dependent)
                        ?.lifecycle,
                    'running',
                );
                assert.equal(
                    snapshot.containers.find((c) => c.service === job)
                        ?.exitCode,
                    0,
                );
                const contents = await docker(
                    'exec',
                    mongo,
                    'mongosh',
                    '--quiet',
                    '--eval',
                    "JSON.stringify(db.getSiblingDB('fixture').values.find().sort({_id:1}).toArray())",
                );
                assert.deepEqual(JSON.parse(contents), [
                    { _id: 'after', runs: 1 },
                    { _id: 'seed', value: 'keep-me' },
                ]);
            };
            await check();
            assert.match(
                output.join('\n'),
                /Warning:.*E11000 duplicate key error/,
            );
            assert.match(
                output.join('\n'),
                /completed with warnings.*1 of 3 scripts/,
            );

            // Recreating containers with retained data must not execute the attempted scripts again.
            await runtime.stopProject({});
            output.length = 0;
            assert.equal(
                (await runtime.apply(project, context)).outcome,
                'success',
            );
            await check();
            assert.match(
                output.join('\n'),
                /previously exited 1; skipping unchanged script/,
            );
            assert.ok(!output.some((line) => line.startsWith('Initializing ')));
        } finally {
            await runtime.stopProject({}).catch(() => {});
            for (const name of [mongo, dependent])
                await docker('rm', '--force', name).catch(() => {});
            for (const name of volumes)
                await docker('volume', 'rm', `${ns}-${name}`).catch(() => {});
            await docker('network', 'rm', `${ns}-chs`).catch(() => {});
            await rm(directory, { recursive: true, force: true });
        }
    },
);
