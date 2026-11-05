import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createMockServer } from '../mocks/runtime/server.mjs';
import { importContract } from '../mocks/runtime/importer.mjs';

const document = JSON.parse(
    await readFile(
        new URL('../mocks/felixvalidator/openapi.json', import.meta.url),
        'utf8',
    ),
);
const catalogue = JSON.parse(
    await readFile(new URL('../mocks/catalogue.json', import.meta.url), 'utf8'),
);
const contract = catalogue.services.felixvalidator;
const xml = (scenario) => {
    const status = scenario === 'error' ? '503' : '200';
    return document.paths['/validate'].post.responses[status].content[
        'text/xml'
    ].examples[scenario].value;
};

async function listen(t, server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    return `http://127.0.0.1:${server.address().port}`;
}

async function fakeMicrocks(t) {
    const calls = [];
    const endpoint = await listen(
        t,
        createServer(async (request, response) => {
            let body = '';
            for await (const chunk of request) body += chunk;
            calls.push({
                path: request.url,
                scenario: request.headers['x-chs-dev-scenario'],
                body,
            });
            const scenario = request.headers['x-chs-dev-scenario'];
            const asyncRequest = request.url.includes('/validate-async');
            response.writeHead(scenario === 'error' ? 503 : 200, {
                'content-type':
                    asyncRequest && scenario !== 'error'
                        ? 'text/plain'
                        : 'text/xml',
            });
            response.end(
                asyncRequest && scenario !== 'error' ? '' : xml(scenario),
            );
        }),
    );
    return { endpoint, calls };
}

function completion() {
    let resolve;
    const received = new Promise((done) => {
        resolve = done;
    });
    return {
        received,
        server: createServer(async (request, response) => {
            let body = '';
            for await (const chunk of request) body += chunk;
            response.writeHead(204);
            response.end();
            resolve({
                body,
                method: request.method,
                path: request.url,
                headers: request.headers,
            });
        }),
    };
}

async function validateCompletion(t, endpoint, scenario) {
    const callback = completion();
    const callbackUrl = `${await listen(t, callback.server)}/account-validator/validate/mock-accounts`;
    const options = { ...contract, endpoint, scenario };
    const proxy = await listen(t, createMockServer(options));
    const response = await fetch(`${proxy}/validate-async?isBase64=true`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Basic bW9jay1rZXk6',
        },
        body: JSON.stringify({
            fileId: 'mock-accounts',
            callbackUrl,
            companyNumber: '00000006',
        }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    const result = await receivedCallback(callback);
    assert.equal(result.method, 'PATCH');
    assert.equal(result.path, '/account-validator/validate/mock-accounts');
    assert.equal(result.body, xml(scenario));
    assert.ok(result.headers['content-type'].startsWith('text/xml'));
    assert.equal(result.headers.authorization, 'Basic bW9jay1rZXk6');
    assert.equal(result.headers['x-chs-dev-scenario'], scenario);
}

async function receivedCallback(callback) {
    let timer;
    try {
        return await Promise.race([
            callback.received,
            new Promise((resolve, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                'The XML completion callback was not delivered.',
                            ),
                        ),
                    5000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

test('async Felix validation acknowledges then PATCHes the selected Microcks XML result', async (t) => {
    const f = await fakeMicrocks(t);
    await validateCompletion(t, f.endpoint, 'success');
    await validateCompletion(t, f.endpoint, 'validation-failed');
    assert.equal(f.calls.length, 4);
    assert.equal(
        f.calls[0].path,
        '/rest/Felix%20Validator/1.0.0/validate-async?isBase64=true',
    );
    assert.equal(f.calls[1].path, '/rest/Felix%20Validator/1.0.0/validate');
    assert.equal(JSON.parse(f.calls[0].body).fileId, 'mock-accounts');
});

test('invalid callback requests are rejected before invoking Microcks', async (t) => {
    const f = await fakeMicrocks(t);
    const proxy = await listen(
        t,
        createMockServer({
            ...contract,
            endpoint: f.endpoint,
            scenario: 'success',
        }),
    );
    for (const body of [
        'invalid JSON',
        '{}',
        '{"callbackUrl":"file:///tmp/result"}',
        'x'.repeat(65537),
    ]) {
        const response = await fetch(`${proxy}/validate-async`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'invalid-callback-request');
    }
    assert.deepEqual(f.calls, []);
});

test('an accepted async request keeps its scenario when the provider selection changes', async (t) => {
    const f = await fakeMicrocks(t);
    const callback = completion();
    const callbackUrl = await listen(t, callback.server);
    const options = { ...contract, endpoint: f.endpoint, scenario: 'success' };
    const proxy = await listen(t, createMockServer(options));
    const response = await fetch(`${proxy}/validate-async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileId: 'mock-accounts', callbackUrl }),
    });
    assert.equal(response.status, 200);
    await response.text();
    options.scenario = 'validation-failed';
    const result = await receivedCallback(callback);
    assert.equal(result.body, xml('success'));
    assert.equal(result.headers['x-chs-dev-scenario'], 'success');
});

test('an unavailable Felix does not schedule a callback and shutdown cancels accepted work', async (t) => {
    const f = await fakeMicrocks(t);
    let callbacks = 0;
    const callbackUrl = await listen(
        t,
        createServer((request, response) => {
            callbacks++;
            request.resume();
            response.end();
        }),
    );
    const controller = new AbortController();
    const options = {
        ...contract,
        endpoint: f.endpoint,
        scenario: 'error',
        signal: controller.signal,
    };
    const proxy = await listen(t, createMockServer(options));
    const send = () =>
        fetch(`${proxy}/validate-async`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                file_id: 'mock-accounts',
                callback_url: callbackUrl,
            }),
        });
    const unavailable = await send();
    assert.equal(unavailable.status, 503);
    assert.equal(await unavailable.text(), xml('error'));
    options.scenario = 'success';
    const accepted = await send();
    assert.equal(accepted.status, 200);
    await accepted.text();
    controller.abort();
    await delay(150);
    assert.equal(callbacks, 0);
    assert.equal(f.calls.length, 2);
});

test('rejected callbacks report failure without changing the accepted HTTP response', async (t) => {
    const f = await fakeMicrocks(t);
    const callbackUrl = await listen(
        t,
        createServer((request, response) => {
            request.resume();
            response.writeHead(500);
            response.end(
                `untrusted ${request.headers.authorization} ${request.url}`,
            );
        }),
    );
    let report;
    const failure = new Promise((resolve) => {
        report = resolve;
    });
    const proxy = await listen(
        t,
        createMockServer({
            ...contract,
            endpoint: f.endpoint,
            scenario: 'success',
            onCallbackError: report,
        }),
    );
    const response = await fetch(`${proxy}/validate-async`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer callback-private-token',
        },
        body: JSON.stringify({
            fileId: 'mock-accounts',
            callbackUrl: `${callbackUrl}?token=callback-query-secret`,
        }),
    });
    assert.equal(response.status, 200);
    const message = await failure;
    assert.match(message, /callback returned HTTP 500/);
    assert.doesNotMatch(
        message,
        /callback-private-token|callback-query-secret|untrusted/,
    );
});

test(
    'Felix XML completion callbacks work against Microcks',
    { skip: !process.env.CHS_MICROCKS_URL },
    async (t) => {
        const endpoint = process.env.CHS_MICROCKS_URL;
        const artifact = new URL(
            '../mocks/felixvalidator/openapi.json',
            import.meta.url,
        );
        await importContract(
            endpoint,
            fileURLToPath(artifact),
            new AbortController().signal,
        );
        await validateCompletion(t, endpoint, 'success');
        await validateCompletion(t, endpoint, 'validation-failed');
    },
);

test('async callback requests preserve UTF-8 characters split between HTTP body chunks', async (t) => {
    const f = await fakeMicrocks(t);
    const callback = completion();
    const callbackUrl = `${await listen(t, callback.server)}/café`;
    const proxy = await listen(
        t,
        createMockServer({
            ...contract,
            endpoint: f.endpoint,
            scenario: 'success',
        }),
    );
    const body = Buffer.from(JSON.stringify({ fileId: 'café', callbackUrl }));
    const split = body.indexOf(Buffer.from('é')) + 1;
    const status = await new Promise((resolve, reject) => {
        const request = httpRequest(
            `${proxy}/validate-async`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
            },
            (response) => {
                response.resume();
                response.once('end', () => resolve(response.statusCode));
            },
        );
        request.once('error', reject);
        request.write(body.subarray(0, split));
        request.end(body.subarray(split));
    });
    assert.equal(status, 200);
    const result = await receivedCallback(callback);
    assert.equal(JSON.parse(f.calls[0].body).fileId, 'café');
    assert.equal(result.path, '/caf%C3%A9');
});

test('shutdown aborts an in-flight result read without sending a callback or logging credentials', async (t) => {
    let entered;
    const reading = new Promise((resolve) => {
        entered = resolve;
    });
    let disconnected;
    const closed = new Promise((resolve) => {
        disconnected = resolve;
    });
    const endpoint = await listen(
        t,
        createServer((request, response) => {
            request.resume();
            if (request.url.endsWith('/validate')) {
                response.once('close', disconnected);
                entered();
                return;
            }
            response.end();
        }),
    );
    let callbacks = 0;
    const callbackUrl = await listen(
        t,
        createServer((request, response) => {
            callbacks++;
            request.resume();
            response.end();
        }),
    );
    const abort = new AbortController();
    const reports = [];
    const proxy = await listen(
        t,
        createMockServer({
            ...contract,
            endpoint,
            scenario: 'success',
            signal: abort.signal,
            onCallbackError: (message) => reports.push(message),
        }),
    );
    const accepted = await fetch(`${proxy}/validate-async`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer callback-private-token',
        },
        body: JSON.stringify({ fileId: 'fixture', callbackUrl }),
    });
    assert.equal(accepted.status, 200);
    await accepted.text();
    await receivedCallback({ received: reading });
    abort.abort();
    await receivedCallback({ received: closed });
    assert.equal(callbacks, 0);
    assert.deepEqual(reports, []);
});
