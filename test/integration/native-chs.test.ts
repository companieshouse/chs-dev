import { cleanupAppleFixture } from './apple-fixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { get } from 'node:http';
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
import { createServer } from 'node:net';
import { AppleNativeStrategy } from '../../src/infrastructure/runtimes/apple-native.js';
import { projectStateDirectory } from '../../src/infrastructure/settings.js';
import { NativeDockerRuntime } from '../../src/infrastructure/native/runtime.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import { namespace } from '../../src/infrastructure/native/compiler.js';
import type { PreparedProject } from '../../src/domain/live.js';
const exec = promisify(execFile);
const apple = process.env.CHS_APPLE_INTEGRATION === '1';
async function availablePort() {
    const server = createServer();
    await new Promise<void>((r) => {
        server.listen(0, '127.0.0.1', r);
    });
    const port = (server.address() as import('node:net').AddressInfo).port;
    await new Promise<void>((r) => {
        server.close(() => r());
    });
    return String(port);
}
function httpGet(
    port: string,
    host: string,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = get(
            { hostname: '127.0.0.1', port, headers: { Host: host } },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve({ status: res.statusCode!, body }));
                res.on('error', reject);
            },
        );
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
    });
}

test(
    'CHS Mongo initialization runner targets native containers and Traefik isolates discovery',
    {
        skip: !apple && process.env.CHS_NATIVE_CHS_INTEGRATION !== '1',
        timeout: 600000,
    },
    async () => {
        const directory = await realpath(
            await mkdtemp(join(tmpdir(), 'chs-native-chs-')),
        );
        const ns = namespace(directory);
        const file = join(directory, 'compose.yaml');
        await mkdir(join(directory, 'scripts', 'fixture'), { recursive: true });
        const script = join(directory, 'scripts', 'fixture', 'setup.mongo.js');
        await writeFile(
            script,
            "db.getSiblingDB('fixture').values.updateOne({_id:'example'},{$set:{value:'native'}},{upsert:true});",
        );
        const hostPort = apple ? await availablePort() : '0';
        const definition = {
            services: {
                mongo: {
                    image: 'mongo:8.2.5-noble',
                    pull_policy: apple ? 'missing' : 'never',
                    volumes: ['data:/data/db'],
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
                    stop_grace_period: '2s',
                },
                'execute-mongo-scripts': {
                    image: '416670754337.dkr.ecr.eu-west-2.amazonaws.com/docker-chs-development-script-runner:latest',
                    pull_policy: apple ? 'missing' : 'never',
                    environment: {
                        ROOT_NAME: 'unused',
                        SCRIPT_CONTAINER_NAME: 'mongo',
                        SCRIPT_SUFFIX: 'mongo',
                        SCRIPT_EXTENSION: 'js',
                    },
                    volumes: [
                        './scripts:/app/scripts',
                        '/var/run/docker.sock:/var/run/docker.sock',
                    ],
                    networks: ['chs'],
                    depends_on: { mongo: { condition: 'service_healthy' } },
                },
                app: {
                    image: 'node:24-bookworm',
                    pull_policy: apple ? 'missing' : 'never',
                    command: [
                        'node',
                        '-e',
                        "require('http').createServer((req,res)=>res.end('native-ingress')).listen(80,'0.0.0.0')",
                    ],
                    labels: {
                        'traefik.http.routers.fixture.rule':
                            'Host(`native-fixture.test`)',
                        'traefik.http.services.fixture.loadbalancer.server.port':
                            '80',
                    },
                    networks: ['chs'],
                    depends_on: {
                        'execute-mongo-scripts': {
                            condition: 'service_completed_successfully',
                        },
                    },
                    stop_grace_period: '1s',
                },
                'ingress-proxy': {
                    image: 'traefik:v3.6.2',
                    pull_policy: apple ? 'missing' : 'never',
                    command: [
                        '--providers.docker',
                        '--entrypoints.web.address=:80',
                        '--log.level=DEBUG',
                    ],
                    volumes: ['/var/run/docker.sock:/var/run/docker.sock'],
                    ports: [
                        {
                            target: 80,
                            published: hostPort,
                            host_ip: '127.0.0.1',
                        },
                    ],
                    networks: ['chs'],
                    depends_on: { app: { condition: 'service_started' } },
                    stop_grace_period: '1s',
                },
            },
            networks: { chs: {} },
            volumes: { data: {} },
        };
        await writeFile(file, stringify(definition));
        const project: PreparedProject = {
            protocolVersion: 1,
            projectName: `test-${ns}`,
            projectDirectory: directory,
            configurationIdentity: 'one',
            composeFiles: [file],
            inventory: Object.keys(definition.services).map((service) => ({
                service,
                mode: 'Service',
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
                  policy: { pollMs: 100, readinessMs: 45000, jobMs: 45000 },
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
        const foreign = `${ns}-foreign`;
        const request = async (port: string, host: string) => {
            if (!apple || process.env.CHS_APPLE_GUEST_HTTP !== '1')
                return httpGet(port, host);
            const result = await docker(
                'exec',
                'app',
                'node',
                '-e',
                `require('http').get({hostname:'ingress-proxy',headers:{Host:${JSON.stringify(host)}}},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,body})))})`,
            );
            return JSON.parse(result);
        };
        try {
            await runtime.apply(project, {});
            const snapshot = await runtime.snapshot();
            const mongo = snapshot.containers.find(
                (c) => c.service === 'mongo',
            )!;
            const query = () =>
                docker(
                    'exec',
                    mongo.id,
                    'mongosh',
                    '--quiet',
                    '--eval',
                    "db.getSiblingDB('fixture').values.findOne({_id:'example'}).value",
                );
            assert.equal(await query(), 'native');
            const proxy = snapshot.containers.find(
                (c) => c.service === 'ingress-proxy',
            )!;
            const details = JSON.parse(await docker('inspect', proxy.id))[0];
            const port = apple
                ? hostPort
                : details.NetworkSettings.Ports['80/tcp'][0].HostPort;
            let body = '';
            for (let attempt = 0; attempt < 50; attempt++) {
                body = await request(port, 'native-fixture.test')
                    .then((r) => r.body)
                    .catch(() => '');
                if (body.includes('native-ingress')) break;
                await new Promise((r) => {
                    setTimeout(r, 200);
                });
            }
            assert.match(
                body,
                /native-ingress/,
                (await runtime.logs(proxy, { tail: 40 })).join('\n'),
            );
            if (!apple)
                await docker(
                    'run',
                    '--detach',
                    '--name',
                    foreign,
                    '--network',
                    `${ns}-chs`,
                    '--label',
                    'traefik.http.routers.foreign.rule=Host(`foreign-fixture.test`)',
                    '--label',
                    'traefik.http.services.foreign.loadbalancer.server.port=80',
                    'alpine:latest',
                    'sleep',
                    '120',
                );
            await new Promise((r) => {
                setTimeout(r, 1500);
            });
            assert.equal(
                (await request(port, 'foreign-fixture.test')).status,
                404,
            );
            await writeFile(
                script,
                "db.getSiblingDB('fixture').values.updateOne({_id:'example'},{$set:{value:'updated'}},{upsert:true});",
            );
            await runtime.apply(project, {});
            assert.equal(await query(), 'updated');
            await runtime.stopProject({});
            if (!apple) await docker('volume', 'inspect', `${ns}-data`);
            const volumeFile = apple
                ? join(
                      projectStateDirectory(directory),
                      'native-apple',
                      'mongo.volumes.json',
                  )
                : join(directory, 'state', 'native', 'mongo.volumes.json');
            const previousAnonymous = await readFile(volumeFile, 'utf8');
            await runtime.apply(project, {});
            assert.equal(await readFile(volumeFile, 'utf8'), previousAnonymous);
        } finally {
            if (!apple) await docker('rm', '--force', foreign).catch(() => {});
            // Collect image-declared anonymous volumes before removing their containers.
            const anonymous: string[] = [];
            for (const c of (
                await runtime.snapshot().catch(() => ({ containers: [] }))
            ).containers) {
                if (apple || c.id.startsWith('task:')) continue;
                const d = JSON.parse(await docker('inspect', c.id))[0];
                anonymous.push(
                    ...d.Mounts.filter(
                        (m: any) =>
                            m.Type === 'volume' && !m.Name.startsWith(ns),
                    ).map((m: any) => m.Name),
                );
            }
            await runtime.stopProject({}).catch(() => {});
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
            if (!apple && anonymous.length)
                await docker('volume', 'rm', ...new Set(anonymous)).catch(
                    () => {},
                );
            await rm(directory, { recursive: true, force: true });
        }
    },
);
