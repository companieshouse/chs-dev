import http from 'node:http';
import net from 'node:net';
import { LifecycleBlocked } from '../domain/live.js';
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
    const deadline = Date.now() + (options.holdMs ?? COLD_START_HOLD_MS);
    return respond(options, request, response, deadline).catch(
        (error: unknown) => {
            options.log?.('Proxy request failed.', {
                cause: 'route-load-failed',
                status: 'failed',
            });
            if (response.destroyed) return;
            if (!response.headersSent) {
                response.writeHead(
                    error instanceof LifecycleBlocked ? 503 : 502,
                    { 'content-type': 'text/plain' },
                );
                response.end(
                    error instanceof LifecycleBlocked
                        ? error.message
                        : 'Upstream failed.',
                );
            } else response.end();
        },
    );
}

async function respond(
    options: ProxyServerOptions,
    request: http.IncomingMessage,
    response: http.ServerResponse,
    deadline: number,
): Promise<void> {
    const host = (request.headers.host ?? '').split(':')[0]!;
    const path = request.url ?? '/';
    const routes = await beforeDeadline(options.routes(), deadline);
    if (!routes) {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end(
            'Routing inspection is still pending - try again shortly.',
        );
        return;
    }
    // Traefik matches Path rules on the pathname, never the query string.
    const route = lookupRoute(routes, host, path.split('?')[0]!);
    if (!route) {
        notFound(response, host, path);
        return;
    }
    observeTraffic(options, route, path);
    const release = !isHealthcheck(path, route.healthcheckPaths)
        ? options.lifecycle?.request(route.service)
        : undefined;
    if (release) response.once('close', release);
    try {
        await serveRoute(options, request, response, route, deadline);
    } finally {
        if (release) response.off('close', release);
        release?.();
    }
}

async function serveRoute(
    options: ProxyServerOptions,
    request: http.IncomingMessage,
    response: http.ServerResponse,
    route: Route,
    deadline: number,
) {
    await waitForUnload(options.lifecycle, route.service, deadline);
    if (Date.now() >= deadline) {
        holdExpired(options, route, response);
        return;
    }
    const path = request.url ?? '/';
    let upstream = await beforeDeadline(options.upstream(route), deadline);
    if (Date.now() >= deadline) {
        holdExpired(options, route, response);
        return;
    }
    if (
        !upstream &&
        !isHealthcheck(path, route.healthcheckPaths) &&
        options.lifecycle?.isLazy(route.service)
    )
        upstream = await coldStart(options, route, response, deadline);
    if (!upstream) {
        if (response.headersSent) return;
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end(`No upstream for ${route.service}`);
        return;
    }
    await forward(request, response, upstream, route);
}

async function waitForUnload(
    lifecycle: ServiceLifecycle | undefined,
    service: string,
    deadline: number,
) {
    if (lifecycle) await beforeDeadline(lifecycle.settled(service), deadline);
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
    deadline: number,
): Promise<ProxyUpstream | undefined> {
    const log: ProxyLog = options.log ?? (() => {});
    const lifecycle = options.lifecycle!;
    log(`cold start of ${route.service} requested`, {
        service: route.service,
        cause: 'cold-start',
        status: 'start',
    });
    try {
        const started = await beforeDeadline(
            lifecycle.start(route.service, deadline).then(() => true),
            deadline,
        );
        if (!started) {
            holdExpired(options, route, response);
            return undefined;
        }
    } catch (error) {
        log(`cold start of ${route.service} failed`, {
            service: route.service,
            cause: 'start-failed',
            status: 'failed',
        });
        response.writeHead(error instanceof LifecycleBlocked ? 503 : 502, {
            'content-type': 'text/plain',
        });
        response.end(
            error instanceof LifecycleBlocked
                ? error.message
                : `Service ${route.service} could not be started.`,
        );
        return undefined;
    }
    const poll = options.pollMs ?? COLD_START_POLL_MS;
    while (Date.now() < deadline) {
        const upstream = await beforeDeadline(
            options.upstream(route),
            deadline,
        );
        if (upstream && (await beforeDeadline(reachable(upstream), deadline))) {
            log(`${route.service} served after cold start`, {
                service: route.service,
                cause: 'cold-start',
                status: 'success',
            });
            return upstream;
        }
        await delay(Math.min(poll, Math.max(0, deadline - Date.now())));
    }
    holdExpired(options, route, response);
    return undefined;
}

function holdExpired(
    options: ProxyServerOptions,
    route: Route,
    response: http.ServerResponse,
) {
    options.log?.(`cold start of ${route.service} hit the hold cap`, {
        service: route.service,
        cause: 'hold-cap',
        status: 'failed',
    });
    stillStarting(response, route.service);
}

function beforeDeadline<T>(
    work: Promise<T>,
    deadline: number,
): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout>;
    const expired = new Promise<undefined>((resolve) => {
        timer = setTimeout(
            () => resolve(undefined),
            Math.max(0, deadline - Date.now()),
        );
    });
    return Promise.race([work, expired]).finally(() => clearTimeout(timer));
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
        const disconnected = () => {
            target.destroy();
            resolve();
        };
        response.once('close', disconnected);
        target.once('close', () => response.off('close', disconnected));
        target.on('error', reject);
        request.pipe(target);
        request.on('error', reject);
    }).catch(() => {
        if (response.headersSent) {
            response.end();
            return;
        }
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end(`Upstream ${route.service} failed.`);
    });
}

export function createProxyServer(options: ProxyServerOptions): http.Server {
    return http.createServer((request, response) => {
        void handleProxyRequest(options, request, response);
    });
}
