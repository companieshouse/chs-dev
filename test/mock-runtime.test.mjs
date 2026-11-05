import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rename, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockServer } from '../mocks/runtime/server.mjs';
import { importContract } from '../mocks/runtime/importer.mjs';
import {
    reconcileContracts,
    waitForBootstrap,
} from '../mocks/runtime/bootstrap.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';

async function listen(t, server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    return `http://127.0.0.1:${server.address().port}`;
}

test('mock proxy keeps method, path, query, body and response status while applying the selected scenario', async (t) => {
    const requests = [];
    const endpoint = await listen(
        t,
        createServer(async (incoming, outgoing) => {
            let body = '';
            for await (const chunk of incoming) body += chunk;
            requests.push({
                path: incoming.url,
                method: incoming.method,
                headers: incoming.headers,
                body,
            });
            outgoing.writeHead(404, {
                'content-type': 'application/json',
                'x-upstream': 'microcks',
            });
            outgoing.end(JSON.stringify({ resource: 'missing' }));
        }),
    );
    const proxy = await listen(
        t,
        createMockServer({
            endpoint,
            title: 'API Example',
            version: '1.0',
            scenario: 'not-found',
            healthPaths: ['/healthcheck'],
        }),
    );
    const response = await fetch(`${proxy}/company/00000006?items=2`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-chs-dev-scenario': 'success',
        },
        body: '{"company":"00000006"}',
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-chs-dev-scenario'), 'not-found');
    assert.equal(response.headers.get('x-upstream'), 'microcks');
    assert.deepEqual(await response.json(), { resource: 'missing' });
    assert.equal(requests[0].method, 'POST');
    assert.equal(
        requests[0].path,
        '/rest/API%20Example/1.0/company/00000006?items=2',
    );
    assert.equal(requests[0].headers['x-chs-dev-scenario'], 'not-found');
    assert.equal(requests[0].body, '{"company":"00000006"}');
    assert.equal((await fetch(`${proxy}/healthcheck`)).status, 200);
    assert.equal(requests.length, 1);
});

test('scenario configuration is read after atomic replacement without restarting the mock proxy', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-mock-proxy-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const configFile = join(directory, 'api.json');
    await writeFile(configFile, JSON.stringify({ scenario: 'success' }));
    const endpoint = await listen(
        t,
        createServer((request, response) => {
            response.writeHead(
                request.headers['x-chs-dev-scenario'] === 'error' ? 503 : 200,
            );
            response.end();
        }),
    );
    const proxy = await listen(
        t,
        createMockServer({
            endpoint,
            title: 'API',
            version: '1',
            healthPaths: [],
            scenarios: [{ name: 'success' }, { name: 'error' }],
            configFile,
        }),
    );
    assert.equal((await fetch(`${proxy}/resource`)).status, 200);
    await writeFile(
        join(directory, 'next.json'),
        JSON.stringify({ scenario: 'error' }),
    );
    await rename(join(directory, 'next.json'), configFile);
    assert.equal((await fetch(`${proxy}/resource`)).status, 503);
    assert.equal(
        (await (await fetch(`${proxy}/__chs_mock/health`)).json()).scenario,
        'error',
    );
    await writeFile(configFile, JSON.stringify({ scenario: 'missing' }));
    const invalid = await fetch(`${proxy}/resource`);
    assert.equal(invalid.status, 503);
    assert.equal((await invalid.json()).error, 'mock-unavailable');
});

test('production bootstrap retries Microcks readiness and reports rejected contracts', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-mock-import-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const artifact = join(directory, 'openapi.json');
    await writeFile(artifact, '{"openapi":"3.0.3"}');
    const bootstrapFile = join(directory, 'bootstrap.json');
    const options = {
        service: 'api',
        title: 'API',
        version: '1',
        mocksRoot: directory,
        bootstrapFile,
        signal: new AbortController().signal,
    };
    await writeFile(
        bootstrapFile,
        JSON.stringify({
            importer: 'api',
            contracts: [
                { title: 'API', version: '1', artifact: 'openapi.json' },
            ],
        }),
    );
    let calls = 0;
    let discoveries = 0;
    const endpoint = await listen(
        t,
        createServer(async (request, response) => {
            if (request.url === '/api/services') {
                discoveries++;
                response.writeHead(discoveries === 1 ? 503 : 200);
                response.end('[]');
                return;
            }
            let body = '';
            for await (const chunk of request) body += chunk;
            assert.equal(request.url, '/api/artifact/upload?mainArtifact=true');
            assert.match(body, /openapi.json/);
            assert.match(body, /3.0.3/);
            calls++;
            response.writeHead(201);
            response.end();
        }),
    );
    await waitForBootstrap({ ...options, endpoint }, new Map());
    assert.equal(discoveries, 2);
    assert.equal(calls, 1);
    const rejected = await listen(
        t,
        createServer((request, response) => {
            request.resume();
            response.writeHead(400);
            response.end('invalid contract');
        }),
    );
    await assert.rejects(
        importContract(rejected, artifact, new AbortController().signal),
        /HTTP 400: invalid contract/,
    );
    await assert.rejects(
        waitForBootstrap(
            { ...options, endpoint, signal: AbortSignal.abort() },
            new Map(),
        ),
        /abort/i,
    );
});

test(
    'repository contracts and scenarios work against Microcks',
    { skip: !process.env.CHS_MICROCKS_URL },
    async (t) => {
        const root = fileURLToPath(new URL('../mocks/', import.meta.url));
        const catalogue = JSON.parse(
            await readFile(join(root, 'catalogue.json'), 'utf8'),
        );
        const endpoint = process.env.CHS_MICROCKS_URL;
        const callback = await listen(
            t,
            createServer((request, response) => {
                request.resume();
                response.writeHead(204);
                response.end();
            }),
        );
        for (const contract of Object.values(catalogue.services)) {
            const artifact = join(root, contract.artifact);
            await importContract(
                endpoint,
                artifact,
                new AbortController().signal,
            );
            const document = JSON.parse(await readFile(artifact, 'utf8'));
            const options = {
                ...contract,
                endpoint,
                scenario: 'success',
                asyncCallback: undefined,
            };
            const proxy = await listen(t, createMockServer(options));
            for (const [template, operations] of Object.entries(
                document.paths,
            )) {
                const path = template.replaceAll(/\{[^}]+\}/g, '00000006');
                for (const method of Object.keys(operations)) {
                    for (const scenario of contract.scenarios) {
                        options.scenario = scenario.name;
                        const response = await fetch(`${proxy}${path}?test=1`, {
                            method: method.toUpperCase(),
                            headers: { 'content-type': 'application/json' },
                            ...(['post', 'patch'].includes(method)
                                ? {
                                      body: JSON.stringify({
                                          fileId: 'mock-accounts',
                                          callbackUrl: callback,
                                      }),
                                  }
                                : {}),
                        });
                        const example = responseExample(
                            operations[method],
                            scenario.name,
                        );
                        assert.equal(
                            response.status,
                            example.status,
                            `${contract.title} ${method} ${path} ${scenario.name}`,
                        );
                        const body = await response.text();
                        assert.doesNotMatch(
                            body,
                            /\{\{[^}]+\}\}/,
                            'Microcks should resolve response templates',
                        );
                        assert.ok(
                            response.headers
                                .get('content-type')
                                ?.startsWith(example.contentType),
                        );
                        if (example.contentType === 'application/json')
                            assert.doesNotThrow(() => JSON.parse(body));
                        else assert.equal(body, example.value);
                        assert.equal(
                            response.headers.get('x-chs-dev-provider'),
                            'mock',
                        );
                    }
                }
            }
        }
    },
);

function responseExample(operation, scenario) {
    for (const [status, response] of Object.entries(operation.responses)) {
        for (const [contentType, content] of Object.entries(
            response.content ?? {},
        )) {
            if (content.examples?.[scenario])
                return {
                    status: Number(status),
                    contentType,
                    value: content.examples[scenario].value,
                };
        }
    }
    assert.fail(`No response example for ${scenario}`);
}

test('one adapter imports contracts sequentially, skips unchanged artifacts and restores a restarted Microcks', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-mock-bootstrap-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const contracts = [
        { title: 'First API', version: '1', artifact: 'first/openapi.json' },
        { title: 'Second API', version: '1', artifact: 'second/openapi.json' },
    ];
    for (const contract of contracts) {
        await mkdir(join(root, contract.artifact.split('/')[0]));
        await writeFile(
            join(root, contract.artifact),
            JSON.stringify({
                openapi: '3.0.3',
                info: { title: contract.title, version: contract.version },
            }),
        );
    }
    const bootstrapFile = join(root, 'bootstrap.json');
    await writeFile(
        bootstrapFile,
        JSON.stringify({ importer: 'first', contracts }),
    );
    let available = [],
        imports = 0,
        active = 0,
        peak = 0;
    const endpoint = await listen(
        t,
        createServer(async (request, response) => {
            if (request.url === '/api/services') {
                response.end(JSON.stringify(available));
                return;
            }
            active++;
            peak = Math.max(peak, active);
            let body = '';
            for await (const chunk of request) body += chunk;
            await delay(10);
            const contract = contracts.find((item) =>
                body.includes(`filename="${item.artifact.replace('/', '-')}"`),
            );
            assert.ok(contract, 'Each contract needs its own upload filename');
            if (!available.some((item) => item.name === contract.title))
                available.push({
                    name: contract.title,
                    version: contract.version,
                });
            imports++;
            active--;
            response.writeHead(201);
            response.end();
        }),
    );
    const base = {
        endpoint,
        bootstrapFile,
        mocksRoot: root,
        signal: new AbortController().signal,
    };
    const importer = { ...base, service: 'first', ...contracts[0] };
    const follower = { ...base, service: 'second', ...contracts[1] };
    const cache = new Map();
    await Promise.all([
        reconcileContracts(importer, cache),
        reconcileContracts(follower, new Map()),
    ]);
    assert.equal(imports, 2);
    assert.equal(peak, 1);
    assert.equal(await reconcileContracts(follower, new Map()), true);
    await reconcileContracts(importer, cache);
    assert.equal(imports, 2);
    await writeFile(join(root, contracts[0].artifact), '{"updated":true}');
    await reconcileContracts(importer, cache);
    assert.equal(imports, 3);
    available = [];
    await reconcileContracts(importer, cache);
    assert.equal(imports, 5);
});
