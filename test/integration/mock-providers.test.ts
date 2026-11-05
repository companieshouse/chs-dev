import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createProxyServer } from '../../src/proxy/server.js';
import { createRouteBuilder } from '../../src/proxy/builder.js';
import { DockerComposeStrategy } from '../../src/infrastructure/runtimes/docker-compose.js';
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
import type { PreparedProject } from '../../src/domain/live.js';

const exec = promisify(execFile);
const docker = async (...args: string[]) =>
    (await exec('docker', args, { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const enabled = process.env.CHS_MOCK_INTEGRATION === '1';

async function availablePort(): Promise<string> {
    const server = createServer();
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
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
                environment: {
                    enforce: async (names) => assert.deepEqual(names, []),
                },
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
        for (const [name, contract] of Object.entries(catalogue.services)) {
            if (!document.services[name]) continue;
            document.services[name].ports = contract.ports.map((target) => ({
                target,
                published: '0',
                host_ip: '127.0.0.1',
            }));
        }
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

test(
    'Compose mock providers route through the proxy, switch scenarios without restarts and restore real dependencies',
    { skip: !enabled, timeout: 300000 },
    async (t) => {
        await docker('compose', 'version', '--short');
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
        const snapshot = async () =>
            (
                JSON.parse(
                    await docker(
                        'inspect',
                        ...(await compose('ps', '-aq')).split('\n'),
                    ),
                ) as any[]
            ).map((item) => ({
                id: item.Id,
                service: item.Config.Labels['com.docker.compose.service'],
            }));
        const apply = async (project: PreparedProject) => {
            prepared = project;
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
            await compose('down', '--volumes');
            await rm(f.root, { recursive: true, force: true });
        });
        await apply(prepared);
        const original = await snapshot();
        assert.equal(original.length, prepared.inventory.length);
        assert.ok(
            !original.some((container) => container.service === 'database'),
        );
        const manager = new DockerComposeStrategy().containers({
            directory: f.directory,
        });
        const list = manager.list.bind(manager);
        manager.list = async (signal) =>
            (await list(signal)).filter(
                (container) => container.currentProject,
            );
        const routes = createRouteBuilder(manager);
        const proxy = createProxyServer({
            routes: async () => (await routes.current()).routes,
            upstream: async (route) => {
                const published = (await routes.current()).published
                    .get(route.service)
                    ?.get(route.port);
                return published
                    ? { host: '127.0.0.1', port: published }
                    : undefined;
            },
        });
        t.after(
            () =>
                new Promise<void>((resolve, reject) => {
                    proxy.close((error) => (error ? reject(error) : resolve()));
                }),
        );
        proxy.listen(0, '127.0.0.1');
        await once(proxy, 'listening');
        const port = String(
            (proxy.address() as import('node:net').AddressInfo).port,
        );
        const paths = {
            'company-profile-api': '/company/00000006',
            'transactions-api-ch-gov-uk': '/transactions/mock-transaction',
            'accounts-filing-api':
                '/transactions/mock-transaction/accounts-filing',
            'company-accounts-api-ch-gov-uk':
                '/transactions/mock-transaction/company-accounts',
        };
        for (const [name, path] of Object.entries(paths)) {
            const body = await request(port, `${name}.mock.test`, path, 200);
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
