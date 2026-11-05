import { setTimeout as delay } from 'node:timers/promises';

async function callbackRequest(incoming, policy) {
    let body = '';
    for await (const chunk of incoming) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536)
            throw new Error('The callback request is too large.');
    }
    const value = JSON.parse(body);
    const address = policy.urlFields
        .map((field) => value?.[field])
        .find(Boolean);
    const url = new URL(address);
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
    )
        throw new Error('The callback URL must use HTTP or HTTPS.');
    return { body, url, authorization: incoming.headers.authorization };
}

function timeoutSignal(options) {
    const timeout = AbortSignal.timeout(10000);
    return options.signal
        ? AbortSignal.any([timeout, options.signal])
        : timeout;
}

async function invokeMock(options, path, body, contentType) {
    const prefix = `/rest/${encodeURIComponent(options.title)}/${encodeURIComponent(options.version)}`;
    return fetch(`${options.endpoint}${prefix}${path}`, {
        method: 'POST',
        headers: {
            'content-type': contentType,
            'x-chs-dev-scenario': options.scenario,
        },
        body,
        signal: timeoutSignal(options),
    });
}

async function deliverCallback(options, request) {
    await delay(100, undefined, { signal: options.signal });
    const result = await invokeMock(
        options,
        options.asyncCallback.resultPath,
        '',
        'text/xml',
    );
    if (!result.ok) {
        await result.body?.cancel();
        throw new Error(
            `Microcks callback result returned HTTP ${result.status}.`,
        );
    }
    const response = await fetch(request.url, {
        method: options.asyncCallback.method,
        headers: {
            'content-type': result.headers.get('content-type') ?? 'text/xml',
            ...(request.authorization
                ? { authorization: request.authorization }
                : {}),
            'x-chs-dev-provider': 'mock',
            'x-chs-dev-scenario': options.scenario,
        },
        body: await result.text(),
        signal: timeoutSignal(options),
        redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok)
        throw new Error(
            `Mock completion callback returned HTTP ${response.status}.`,
        );
}

export async function handleCallback(incoming, outgoing, options) {
    const selection = { ...options };
    let request;
    try {
        request = await callbackRequest(incoming, options.asyncCallback);
    } catch {
        outgoing.writeHead(400, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify({ error: 'invalid-callback-request' }));
        return;
    }
    const response = await invokeMock(
        selection,
        incoming.url,
        request.body,
        'application/json',
    );
    const body = await response.text();
    outgoing.writeHead(response.status, {
        'content-type': response.headers.get('content-type') ?? 'text/plain',
        'x-chs-dev-provider': 'mock',
        'x-chs-dev-scenario': options.scenario,
    });
    outgoing.end(body);
    if (!response.ok) return;
    void deliverCallback(selection, request).catch((error) => {
        if (options.signal?.aborted) return;
        const report = options.onCallbackError ?? console.error;
        report(`Mock completion callback failed: ${error.message}`);
    });
}
