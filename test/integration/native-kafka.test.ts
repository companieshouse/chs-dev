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
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stringify } from 'yaml';
import { AppleNativeStrategy } from '../../src/infrastructure/runtimes/apple-native.js';
import { NativeDockerRuntime } from '../../src/infrastructure/native/runtime.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import { namespace } from '../../src/infrastructure/native/compiler.js';
const exec = promisify(execFile);
const apple = process.env.CHS_APPLE_INTEGRATION === '1';
test(
    'CHS Kafka initialization runner uses service DNS and advertised listeners',
    {
        skip: !apple && process.env.CHS_NATIVE_CHS_INTEGRATION !== '1',
        timeout: 600000,
    },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-native-kafka-')),
        );
        const file = join(directory, 'compose.yaml');
        const ns = namespace(directory);
        await mkdir(join(directory, 'scripts', 'fixture'), { recursive: true });
        await writeFile(
            join(directory, 'scripts', 'fixture', 'setup.kafka.sh'),
            'kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic native-fixture --partitions 1 --replication-factor 1\n',
        );
        const definition = {
            services: {
                zookeeper: {
                    image: 'bitnamilegacy/zookeeper:3',
                    pull_policy: apple ? 'missing' : 'never',
                    environment: {
                        ALLOW_ANONYMOUS_LOGIN: 'yes',
                        ZOO_4LW_COMMANDS_WHITELIST: 'ruok',
                    },
                    healthcheck: {
                        test: [
                            'CMD',
                            '/bin/bash',
                            '-c',
                            'echo ruok | nc -w 2 localhost 2181 | grep imok',
                        ],
                        interval: '2s',
                        timeout: '3s',
                        retries: 20,
                        start_period: '5s',
                    },
                    networks: ['chs'],
                    stop_grace_period: '2s',
                },
                kafka: {
                    image: 'bitnamilegacy/kafka:2',
                    pull_policy: apple ? 'missing' : 'never',
                    environment: {
                        ALLOW_PLAINTEXT_LISTENER: 'yes',
                        KAFKA_CFG_LISTENERS: 'PLAINTEXT://:9092',
                        KAFKA_CFG_ADVERTISED_LISTENERS:
                            'PLAINTEXT://kafka:9092',
                        KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP:
                            'PLAINTEXT:PLAINTEXT',
                        KAFKA_CFG_INTER_BROKER_LISTENER_NAME: 'PLAINTEXT',
                        KAFKA_CFG_ZOOKEEPER_CONNECT: 'zookeeper:2181',
                    },
                    healthcheck: {
                        test: [
                            'CMD-SHELL',
                            'kafka-topics.sh --list --bootstrap-server kafka:9092 >/dev/null 2>&1',
                        ],
                        interval: '2s',
                        timeout: '10s',
                        retries: 20,
                        start_period: '10s',
                    },
                    networks: ['chs'],
                    depends_on: {
                        zookeeper: {
                            condition: 'service_healthy',
                            restart: true,
                        },
                    },
                    stop_grace_period: '2s',
                },
                'execute-kafka-scripts': {
                    image: '416670754337.dkr.ecr.eu-west-2.amazonaws.com/docker-chs-development-script-runner:latest',
                    pull_policy: apple ? 'missing' : 'never',
                    environment: {
                        ROOT_NAME: 'unused',
                        SCRIPT_CONTAINER_NAME: 'kafka',
                        SCRIPT_SUFFIX: 'kafka',
                    },
                    volumes: [
                        './scripts:/app/scripts',
                        '/var/run/docker.sock:/var/run/docker.sock',
                    ],
                    networks: ['chs'],
                    depends_on: { kafka: { condition: 'service_healthy' } },
                },
            },
            networks: { chs: {} },
        };
        await writeFile(file, stringify(definition));
        const runtime = apple
            ? new AppleNativeStrategy().live({
                  directory,
                  name: ns,
                  environment: { resolve: async () => ({ ...process.env }) },
              })
            : new NativeDockerRuntime({
                  directory,
                  projectName: ns,
                  stateDirectory: join(directory, 'state'),
                  execute: createProcessExecutor(),
                  environment: { resolve: async () => ({ ...process.env }) },
                  policy: { pollMs: 250, readinessMs: 90000, jobMs: 90000 },
              });
        const docker = async (...args: string[]) =>
            (
                await exec(
                    apple
                        ? (process.env.CHS_DEV_APPLE_CLI ?? 'container')
                        : 'docker',
                    args,
                    { maxBuffer: 4 * 1024 * 1024 },
                )
            ).stdout.trim();
        try {
            await runtime.apply(
                {
                    protocolVersion: 1,
                    projectName: ns,
                    projectDirectory: directory,
                    configurationIdentity: 'one',
                    composeFiles: [file],
                    inventory: Object.keys(definition.services).map(
                        (service) => ({ service, mode: 'Service' }),
                    ),
                    environmentRequirements: [],
                },
                apple
                    ? { onOutput: (e) => process.stdout.write(e.text + '\n') }
                    : {},
            );
            const kafka = (await runtime.snapshot()).containers.find(
                (c) => c.service === 'kafka',
            )!;
            assert.match(
                await docker(
                    'exec',
                    kafka.id,
                    'kafka-topics.sh',
                    '--list',
                    '--bootstrap-server',
                    'kafka:9092',
                ),
                /native-fixture/,
            );
        } finally {
            await runtime.stopProject({}).catch(() => {});
            const anonymous: string[] = [];
            for (const service of Object.keys(definition.services)) {
                const saved = await readFile(
                    join(
                        directory,
                        'state',
                        'native',
                        `${service}.volumes.json`,
                    ),
                    'utf8',
                )
                    .then(JSON.parse)
                    .catch(() => ({}));
                anonymous.push(...(Object.values(saved) as string[]));
            }
            if (apple) await cleanupAppleFixture(runtime, directory);
            else await runtime.close?.();
            const ids = apple
                ? ''
                : await docker(
                      'network',
                      'ls',
                      '--quiet',
                      '--filter',
                      `label=chs.dev.project=${ns}`,
                  );
            if (ids) await docker('network', 'rm', ...ids.split('\n'));
            if (!apple && anonymous.length)
                await docker('volume', 'rm', ...new Set(anonymous));
            await rm(directory, { recursive: true, force: true });
        }
    },
);
