import http from 'node:http';
import net from 'node:net';
import { lookupRoute, type Route } from './routes.js';
import type { RequestAccounting } from './accounting.js';
import { isHealthcheck } from './accounting.js';
import type { UsageLedger } from './usage-ledger.js';
import {
    COLD_START_HOLD_MS,
    COLD_START_POLL_MS,
    type ProxyLog,
    type ServiceLifecycle,
} from './lifecycle.js';

export interface ProxyUpstream {
    host: string;
    port: number;
}

export interface ProxyServerOptions {
    routes(): Promise<Route[]>;
    upstream(route: Route): Promise<ProxyUpstream | undefined>;
    accounting?: RequestAccounting;
    lifecycle?: ServiceLifecycle;
    /** Per-run usage evidence for the usage cache. */
    usage?: UsageLedger;
    /** Test override for the cold-start hold. */
    holdMs?: number;
    /** Test override for the cold-start reachability poll. */
    pollMs?: number;
    log?: ProxyLog;
}

/**
 * The request path of the daemon-hosted proxy: find the highest-priority
 * route for the request's host and path, stream the request to the same
 * upstream container and port Traefik would pick, and answer 404 with the
 * missing route when nothing matches.
 */
export function handleProxyRequest(
    options: ProxyServerOptions,
    request: http.IncomingMessage,
    response: http.ServerResponse,
): Promise<void> {
    const host = (request.headers.host ?? '').split(':')[0]!;
    const path = request.url ?? '/';
    return respond(options, request, response, host, path).catch((error) => {
        options.log?.(`Proxy error for ${host}${path}: ${errorMessage(error)}`);
        if (!response.headersSent) {
            response.writeHead(502, { 'content-type': 'text/plain' });
            response.end(`Upstream failed: ${errorMessage(error)}`);
        } else {
            response.end();
        }
    });
}

async function respond(
    options: ProxyServerOptions,
    request: http.IncomingMessage,
    response: http.ServerResponse,
    host: string,
    path: string,
): Promise<void> {
    const routes = await options.routes();
    const route = lookupRoute(routes, host, path);
    if (!route) {
        notFound(response, host, path);
        return;
    }
    observeTraffic(options, route, path);
    let upstream = await options.upstream(route);
    if (!upstream && options.lifecycle?.isLazy(route.service))
        upstream = await coldStart(options, route, response);
    if (!upstream) {
        if (response.headersSent) return;
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end(`No upstream for ${route.service}`);
        return;
    }
    await forward(request, response, upstream, route);
}

/**
 * Records one proxied request: the counters keep healthcheck traffic
 * separate, while the idle timer and the usage ledger only see real traffic.
 */
function observeTraffic(
    options: ProxyServerOptions,
    route: Route,
    path: string,
): void {
    options.accounting?.record(route.service, path, route.healthcheckPaths);
    if (isHealthcheck(path, route.healthcheckPaths)) return;
    options.lifecycle?.touch(route.service);
    options.usage?.record(route.service);
}

/**
 * Starts a stopped lazy service and holds the request until its upstream is
 * reachable or the hold expires. Answers 502 (failed start) or 503 (still
 * starting) itself and returns undefined when the request is already
 * answered.
 */
async function coldStart(
    options: ProxyServerOptions,
    route: Route,
    response: http.ServerResponse,
): Promise<ProxyUpstream | undefined> {
    const log: ProxyLog = options.log ?? (() => {});
    const lifecycle = options.lifecycle!;
    log(`cold start of ${route.service} requested`, {
        service: route.service,
        cause: 'cold-start',
        status: 'start',
    });
    try {
        await lifecycle.start(route.service);
    } catch (error) {
        log(`cold start of ${route.service} failed: ${errorMessage(error)}`, {
            service: route.service,
            cause: 'start-failed',
            status: 'failed',
        });
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end(`Service ${route.service} could not be started.`);
        return undefined;
    }
    const deadline = Date.now() + (options.holdMs ?? COLD_START_HOLD_MS);
    const poll = options.pollMs ?? COLD_START_POLL_MS;
    while (Date.now() < deadline) {
        const upstream = await options.upstream(route);
        if (upstream && (await reachable(upstream))) {
            log(`${route.service} served after cold start`, {
                service: route.service,
                cause: 'cold-start',
                status: 'success',
            });
            return upstream;
        }
        await delay(poll);
    }
    log(`cold start of ${route.service} hit the hold cap`, {
        service: route.service,
        cause: 'hold-cap',
        status: 'failed',
    });
    stillStarting(response, route.service);
    return undefined;
}

function reachable(upstream: ProxyUpstream): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({
            host: upstream.host,
            port: upstream.port,
            timeout: 1000,
        });
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => resolve(false));
    });
}

function delay(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

function stillStarting(response: http.ServerResponse, service: string) {
    response.writeHead(503, { 'content-type': 'text/plain' });
    response.end(`Service ${service} is still starting - try again shortly.`);
}

function notFound(response: http.ServerResponse, host: string, path: string) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end(`No route for ${host}${path}`);
}

async function forward(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    upstream: ProxyUpstream,
    route: Route,
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const target = http.request(
            {
                host: upstream.host,
                port: upstream.port,
                path: request.url,
                method: request.method,
                headers: {
                    ...request.headers,
                    host: `${upstream.host}:${upstream.port}`,
                },
            },
            (upstreamResponse) => {
                response.writeHead(
                    upstreamResponse.statusCode ?? 502,
                    upstreamResponse.headers,
                );
                upstreamResponse.pipe(response);
                upstreamResponse.on('end', resolve);
                upstreamResponse.on('error', reject);
            },
        );
        target.on('error', reject);
        request.pipe(target);
        request.on('error', reject);
    }).catch((error: unknown) => {
        if (response.headersSent) {
            response.end();
            return;
        }
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end(
            `Upstream ${route.service} failed: ${errorMessage(error)}`,
        );
    });
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function createProxyServer(options: ProxyServerOptions): http.Server {
    return http.createServer((request, response) => {
        void handleProxyRequest(options, request, response);
    });
}
