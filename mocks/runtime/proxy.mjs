import { request } from 'node:http';

const hopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

function forwardedHeaders(headers) {
    const blocked = new Set([
        ...hopHeaders,
        ...(headers.connection ?? '')
            .split(',')
            .map((name) => name.trim().toLowerCase()),
    ]);
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name]) => !blocked.has(name.toLowerCase()),
        ),
    );
}

export function mockFailure(response, message) {
    if (response.headersSent) return response.destroy();
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'mock-unavailable', message }));
}

export function proxyMock(incoming, outgoing, options) {
    const target = new URL(options.endpoint);
    const prefix = `/rest/${encodeURIComponent(options.title)}/${encodeURIComponent(options.version)}`;
    const upstream = request(
        target,
        {
            method: incoming.method,
            path: `${prefix}${incoming.url}`,
            headers: {
                ...forwardedHeaders(incoming.headers),
                host: target.host,
                'x-chs-dev-scenario': options.scenario,
            },
            timeout: 30000,
        },
        (response) => {
            outgoing.writeHead(response.statusCode ?? 502, {
                ...forwardedHeaders(response.headers),
                'x-chs-dev-provider': 'mock',
                'x-chs-dev-scenario': options.scenario,
            });
            response.on('error', () => outgoing.destroy());
            response.pipe(outgoing);
        },
    );
    upstream.on('timeout', () =>
        upstream.destroy(new Error('Microcks request timed out.')),
    );
    upstream.on('error', (error) => mockFailure(outgoing, error.message));
    incoming.on('aborted', () => upstream.destroy());
    incoming.on('error', () => upstream.destroy());
    outgoing.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
}
