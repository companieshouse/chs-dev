import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    rm,
    realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse, stringify } from 'yaml';
import { prepareProject } from '../../src/project/prepare.js';
import { nodeProjectFs } from '../../src/project/files.js';
import { readMockCatalogue } from '../../src/project/mock-catalogue.js';
import { NativeDockerRuntime } from '../../src/infrastructure/native/runtime.js';
import { createProcessExecutor } from '../../src/infrastructure/live-process.js';
import { namespace } from '../../src/infrastructure/native/compiler.js';
import type { PreparedProject } from '../../src/domain/live.js';
import { PortableDefinitionCompiler } from '../../src/infrastructure/native/portable-compiler.js';
import { adaptPortableProject } from '../../src/infrastructure/native/portable-chs.js';

const exec = promisify(execFile);
const docker = async (...args: string[]) =>
    (await exec('docker', args, { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const enabled = process.env.CHS_MOCK_INTEGRATION === '1';

async function availablePort(): Promise<string> {
    const server = createServer();
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = String(
        (server.address() as import('node:net').AddressInfo).port,
    );
    await new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
    return port;
}

async function fixture() {
    const root = await realpath(
        await mkdtemp(join(tmpdir(), 'chs-mock-integration-')),
    );
    const directory = join(root, 'project');
    const state = join(root, 'state');
    await mkdir(join(directory, 'services/infrastructure'), {
        recursive: true,
    });
    await mkdir(join(directory, 'services/modules/api'), { recursive: true });
    await mkdir(join(state, 'operations'), { recursive: true });
    const catalogue = await readMockCatalogue();
    const ingressPort = await availablePort();
    await writeFile(
        join(directory, 'services/infrastructure/docker-compose.yaml'),
        stringify({
            services: {
                'ingress-proxy': {
                    image: 'traefik:v3.6.2',
                    command: [
                        '--providers.docker',
                        '--providers.docker.exposedbydefault=false',
                    ],
                    volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
                    ports: [
                        {
                            target: 80,
                            published: ingressPort,
                            host_ip: '127.0.0.1',
                        },
                    ],
                    networks: ['chs'],
                },
            },
            networks: { chs: {} },
        }),
    );
    const services: Record<string, unknown> = {
        database: {
            image: 'node:22.20.0-alpine',
            command: ['node', '-e', 'setInterval(()=>{},1000)'],
            networks: ['chs'],
        },
    };
    for (const [name, contract] of Object.entries(catalogue.services)) {
        services[name] = {
            image: 'node:22.20.0-alpine',
            command: [
                'node',
                '-e',
                `require('http').createServer((q,s)=>s.end('real-service')).listen(${contract.ports[0]},'0.0.0.0')`,
            ],
            labels: {
                'traefik.enable': 'true',
                [`traefik.http.routers.${name}.rule`]: `Host(\`${name}.mock.test\`)`,
                [`traefik.http.services.${name}.loadbalancer.server.port`]:
                    String(contract.ports[0]),
            },
            depends_on: ['database'],
            networks: ['chs'],
            expose: contract.ports,
        };
    }
    await writeFile(
        join(directory, 'services/modules/api/apis.docker-compose.yaml'),
        stringify({ services }),
    );
    const configuration = {
        services: Object.keys(catalogue.services),
        serviceProviders: Object.fromEntries(
            Object.keys(catalogue.services).map((name) => [name, 'mock']),
        ),
        mockScenarios: {} as Record<string, string>,
    };
    let operation = 0;
    const prepare = async () => {
        const result = await prepareProject(
            {
                projectDirectory: directory,
                configuration: stringify(configuration),
                outputDirectory: join(state, 'operations', String(++operation)),
                mockRuntimeDirectory: join(state, 'mocks'),
            },
            {
                fs: nodeProjectFs,
                env: {
                    COMPOSE_PROJECT_NAME: root.split('/').at(-1)!.toLowerCase(),
                },
                environment: async (names) => assert.deepEqual(names, []),
                prepareRepository: async () => {
                    throw new Error('Mocks must not clone repositories.');
                },
            },
        );
        const document = parse(await readFile(result.composeFiles[0], 'utf8'));
        if (document.services['chs-dev-microcks'])
            document.services['chs-dev-microcks'].ports = [
                { target: 8080, published: '0', host_ip: '127.0.0.1' },
            ];
        await writeFile(result.composeFiles[0], stringify(document));
        return result;
    };
    return { root, directory, state, configuration, prepare };
}

async function request(
    port: string,
    host: string,
    path: string,
    expected: number,
) {
    let last = '';
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const response = await httpResponse(port, host, path);
            if (response.status === expected) return response.body;
            last = `${response.status}: ${response.body}`;
        } catch (error) {
            last = String(error);
        }
        await delay(250);
    }
    throw new Error(`Ingress did not return ${expected}: ${last}`);
}

function httpResponse(
    port: string,
    host: string,
    path: string,
    options: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
    } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const request = httpRequest(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method: options.method,
                headers: { Host: host, ...options.headers },
            },
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    body += chunk;
                });
                response.on('end', () =>
                    resolve({ status: response.statusCode!, body }),
                );
                response.on('error', reject);
            },
        );
        request.on('error', reject);
        request.setTimeout(3000, () =>
            request.destroy(new Error('Ingress request timed out.')),
        );
        request.end(options.body);
    });
}

for (const backend of ['compose', 'native'] as const) {
    test(
        `${backend} mock providers route through ingress, switch scenarios without restarts and restore real dependencies`,
        { skip: !enabled, timeout: 300000 },
        async (t) => {
            if (backend === 'native') {
                const occupied = new Set(
                    (await docker('ps', '-a', '--format', '{{.Names}}')).split(
                        '\n',
                    ),
                );
                const catalogue = await readMockCatalogue();
                if (
                    [
                        ...Object.keys(catalogue.services),
                        'ingress-proxy',
                        'chs-dev-microcks',
                        'database',
                    ].some((name) => occupied.has(name))
                ) {
                    t.skip(
                        'Native Docker requires free exact service names; another CHS environment is running.',
                    );
                    return;
                }
            }
            const f = await fixture();
            let prepared = await f.prepare();
            const compose = (...args: string[]) =>
                docker(
                    'compose',
                    '--project-directory',
                    f.directory,
                    '-p',
                    prepared.projectName,
                    '-f',
                    prepared.composeFiles[0],
                    ...args,
                );
            const runtime =
                backend === 'native'
                    ? new NativeDockerRuntime({
                          directory: f.directory,
                          projectName: prepared.projectName,
                          stateDirectory: f.state,
                          execute: createProcessExecutor(),
                          environment: {
                              resolve: async () => ({ ...process.env }),
                          },
                          policy: { pollMs: 100, readinessMs: 120000 },
                      })
                    : undefined;
            const snapshot = async () =>
                runtime
                    ? (await runtime.snapshot()).containers
                    : (
                          JSON.parse(
                              await docker(
                                  'inspect',
                                  ...(await compose('ps', '-aq')).split('\n'),
                              ),
                          ) as any[]
                      ).map((item) => ({
                          id: item.Id,
                          service:
                              item.Config.Labels['com.docker.compose.service'],
                      }));
            const apply = async (project: PreparedProject) => {
                prepared = project;
                if (runtime) {
                    const result = await runtime.apply(project, {});
                    assert.equal(result.outcome, 'success', result.message);
                } else
                    await compose(
                        'up',
                        '-d',
                        '--wait',
                        '--wait-timeout',
                        '180',
                        '--remove-orphans',
                    );
            };
            t.after(async () => {
                if (runtime) {
                    await runtime.stopProject({});
                    await runtime.close?.();
                    const networks = await docker(
                        'network',
                        'ls',
                        '-q',
                        '--filter',
                        `label=chs.dev.project=${namespace(f.directory)}`,
                    );
                    if (networks)
                        await docker('network', 'rm', ...networks.split('\n'));
                } else await compose('down', '--volumes');
                await rm(f.root, { recursive: true, force: true });
            });
            await apply(prepared);
            const original = await snapshot();
            assert.equal(original.length, prepared.inventory.length);
            assert.ok(
                !original.some((container) => container.service === 'database'),
            );
            const ingress = original.find(
                (container) => container.service === 'ingress-proxy',
            )!;
            const inspect = JSON.parse(await docker('inspect', ingress.id))[0];
            const port = inspect.NetworkSettings.Ports['80/tcp'][0].HostPort;
            const paths = {
                'company-profile-api': '/company/00000006',
                'transactions-api-ch-gov-uk': '/transactions/mock-transaction',
                'accounts-filing-api':
                    '/transactions/mock-transaction/accounts-filing',
                'company-accounts-api-ch-gov-uk':
                    '/transactions/mock-transaction/company-accounts',
            };
            for (const [name, path] of Object.entries(paths)) {
                const body = await request(
                    port,
                    `${name}.mock.test`,
                    path,
                    200,
                );
                assert.doesNotThrow(() => JSON.parse(body));
            }
            const felix = await httpResponse(
                port,
                'felixvalidator.mock.test',
                '/felixvalidator/healthcheck',
            );
            assert.equal(felix.status, 200);
            assert.equal(JSON.parse(felix.body).provider, 'mock');
            const validation = await httpResponse(
                port,
                'felixvalidator.mock.test',
                '/validateBase64',
                {
                    method: 'POST',
                    body: 'synthetic-accounts',
                    headers: { 'content-type': 'text/plain' },
                },
            );
            assert.equal(validation.status, 200);
            assert.match(validation.body, /validationStatus="OK"/);
            f.configuration.mockScenarios['company-profile-api'] = 'error';
            f.configuration.mockScenarios.felixvalidator = 'validation-failed';
            await apply(await f.prepare());
            assert.match(
                await request(
                    port,
                    'company-profile-api.mock.test',
                    paths['company-profile-api'],
                    503,
                ),
                /service-unavailable/,
            );
            const rejected = await httpResponse(
                port,
                'felixvalidator.mock.test',
                '/validate',
                {
                    method: 'POST',
                    body: 'synthetic-accounts',
                    headers: { 'content-type': 'text/plain' },
                },
            );
            assert.equal(rejected.status, 200);
            assert.match(rejected.body, /validationStatus="FAILED"/);
            assert.deepEqual(
                (await snapshot()).map((container) => container.id).sort(),
                original.map((container) => container.id).sort(),
                'Scenario changes must not recreate any container',
            );
            const engine = original.find(
                (container) => container.service === 'chs-dev-microcks',
            )!;
            await docker('restart', engine.id);
            assert.match(
                await request(
                    port,
                    'company-accounts-api-ch-gov-uk.mock.test',
                    paths['company-accounts-api-ch-gov-uk'],
                    200,
                ),
                /mock-company-accounts/,
            );
            f.configuration.serviceProviders['accounts-filing-api'] = 'service';
            await apply(await f.prepare());
            assert.ok(
                (await snapshot()).some(
                    (container) => container.service === 'database',
                ),
            );
            assert.equal(
                await request(
                    port,
                    'accounts-filing-api.mock.test',
                    paths['accounts-filing-api'],
                    200,
                ),
                'real-service',
            );
            f.configuration.serviceProviders['accounts-filing-api'] = 'mock';
            await apply(await f.prepare());
            assert.ok(
                !(await snapshot()).some(
                    (container) => container.service === 'database',
                ),
            );
            assert.match(
                await request(
                    port,
                    'accounts-filing-api.mock.test',
                    paths['accounts-filing-api'],
                    200,
                ),
                /mock-accounts/,
            );
        },
    );
}

test('mock definitions compile and adapt for native Docker and Apple without starting containers', async (t) => {
    const f = await fixture();
    t.after(() => rm(f.root, { recursive: true, force: true }));
    const prepared = await f.prepare();
    const project = await new PortableDefinitionCompiler().compile(prepared, {
        environment: {},
    });
    assert.equal(
        Object.keys(project.services).length,
        prepared.inventory.length,
    );
    assert.deepEqual(
        Object.keys(project.services['company-profile-api'].dependencies),
        ['chs-dev-microcks'],
    );
    assert.deepEqual(project.services['accounts-filing-api'].expose, ['3000']);
    project.namespace = 'chs-apple-mock-test';
    await adaptPortableProject(project, prepared, f.state);
    assert.ok(
        project.services['ingress-proxy'].command?.includes(
            '--providers.file.watch=true',
        ),
    );
    for (const name of Object.keys((await readMockCatalogue()).services)) {
        assert.equal(project.services[name].mode, 'Mock');
        assert.ok(
            project.services[name].mounts.every(
                (mount) => mount.type === 'bind' && mount.readOnly,
            ),
        );
    }
});
