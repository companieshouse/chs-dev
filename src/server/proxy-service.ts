import { createProxyServer, type ProxyUpstream } from '../proxy/server.js';
import { createRouteBuilder } from '../proxy/builder.js';
import {
    createAccounting,
    type RequestAccounting,
} from '../proxy/accounting.js';
import type { UsageLedger } from '../proxy/usage-ledger.js';
import {
    createLazyLifecycle,
    IDLE_SWEEP_MS,
    lazyChain,
    type ProxyLog,
    type ServiceLifecycle,
} from '../proxy/lifecycle.js';
import type { Route } from '../proxy/routes.js';
import type { ContainerManager } from '../domain/containers.js';
import type { LiveController } from '../application/live-controller.js';
import type { RuntimeStrategy } from '../domain/runtime-strategy.js';
import { DockerComposeStrategy } from '../infrastructure/runtimes/docker-compose.js';
import { tuiLog } from '../infrastructure/tui-log.js';

/** The host port the current ingress (Traefik) listens on. */
export const PROXY_PORT = 80;

/** How long the proxy waits before retrying a busy ingress port. */
const BIND_RETRY_MS = 30_000;

export interface ProxyState {
    counts: Record<string, number>;
    excluded: Record<string, number>;
    coldStarting: string[];
    lazy: string[];
}

export interface DaemonProxy {
    close(): Promise<void>;
    /** In-memory request counters, healthcheck traffic separated. */
    accounting: RequestAccounting;
    /** Resolves once the proxy owns its port. */
    listening: Promise<void>;
    /** Counters plus lazy and cold-starting services. */
    state(): ProxyState;
}

/**
 * Hosts the label-driven reverse proxy inside the daemon. Routes come from
 * applied container metadata, including stopped lazy containers. Upstreams
 * are the same containers and ports
 * Traefik picks, and lazy services cold-start on request and unload when
 * idle. Binding is best-effort: while Traefik still owns the ingress port
 * the proxy logs and stays idle, leaving Traefik unaffected.
 */
export function startDaemonProxy(
    options: {
        runtime?: () => RuntimeStrategy;
        accounting?: RequestAccounting;
        controller?: () => LiveController | undefined;
        /** Per-run usage evidence for the usage cache. */
        ledger?: UsageLedger;
        /** Test override for the busy-port retry interval. */
        bindRetryMs?: number;
        /** Test override for the ingress port. */
        portOverride?: number;
    } = {},
): DaemonProxy {
    const runtime = options.runtime?.() ?? new DockerComposeStrategy();
    const accounting = options.accounting ?? createAccounting();
    const port = options.portOverride ?? PROXY_PORT;
    const log: ProxyLog = (message, event) => {
        tuiLog?.write('proxy', { ...event });
        process.stderr.write(`chs-dev proxy: ${message}\n`);
    };
    const routingRef: { current?: ReturnType<typeof createRouting> } = {};
    const lifecycle = daemonLifecycle(options.controller, log, routingRef);
    const routing = createRouting({
        runtime,
        accounting,
        lifecycle,
        controller: options.controller,
    });
    routingRef.current = routing;
    const server = createProxyServer({
        routes: routing.routes,
        upstream: routing.upstream,
        accounting,
        lifecycle,
        usage: options.ledger,
        log,
    });
    let retrying = false;
    server.on('error', (error: NodeJS.ErrnoException) => {
        log(bindFailureMessage(error, port), {
            cause: 'bind-failed',
            status: 'failed',
        });
        if (!retryableBind(error) || retrying) return;
        retrying = true;
        const retry = setInterval(() => {
            server.listen(port);
        }, options.bindRetryMs ?? BIND_RETRY_MS);
        retry.unref();
        server.once('listening', () => {
            clearInterval(retry);
            log(`proxy took over port ${port}`, {
                cause: 'bind-acquired',
                status: 'success',
            });
        });
    });
    server.listen(port);
    const sweeper = startIdleSweeper(lifecycle, accounting);
    return {
        accounting,
        listening: new Promise<void>((resolve) => {
            server.once('listening', () => resolve());
        }),
        state: () => ({
            ...accounting.snapshot(),
            coldStarting: lifecycle.coldStarting(),
            lazy: [...routing.knownLazy].sort(),
        }),
        close: async () => {
            clearInterval(sweeper);
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        },
    };
}

/** Lazy lifecycle wired to the routing table once it exists. */
function daemonLifecycle(
    controller: (() => LiveController | undefined) | undefined,
    log: ProxyLog,
    routingRef: { current?: ReturnType<typeof createRouting> },
): ServiceLifecycle {
    return createLazyLifecycle({
        isLazy: (service) =>
            routingRef.current?.knownLazy.has(service) ?? false,
        ...controllerLifecycle(controller, log, (service) =>
            routingRef.current
                ? routingRef.current.chainFor(service)
                : [service],
        ),
    });
}

function retryableBind(error: NodeJS.ErrnoException) {
    return error.code === 'EACCES' || error.code === 'EADDRINUSE';
}

/** Routes and lifecycle policy come from applied containers, never saved edits. */
function createRouting(deps: {
    runtime: RuntimeStrategy;
    accounting: RequestAccounting;
    lifecycle: ServiceLifecycle;
    controller?: () => LiveController | undefined;
}) {
    const knownLazy = new Set<string>();
    let active: { directory: string; manager: ContainerManager } | undefined;
    let builder: ReturnType<typeof createRouteBuilder> | undefined;
    let dependencies = new Map<string, readonly string[]>();

    const currentBuilder = () => {
        const directory = deps.controller?.()?.getSnapshot()
            .observed?.projectDirectory;
        if (!directory) return undefined;
        if (active?.directory === directory) return builder;
        const manager = deps.runtime.containers?.({ directory });
        if (!manager) return undefined;
        active = { directory, manager };
        builder = createRouteBuilder(manager, deps.accounting);
        return builder;
    };
    const refresh = async () => {
        const current = currentBuilder();
        if (!current) return undefined;
        const resolved = await current.current();
        dependencies = resolved.dependencies;
        knownLazy.clear();
        for (const service of resolved.lazy) knownLazy.add(service);
        for (const service of knownLazy) {
            if (
                resolved.addresses.has(service) ||
                resolved.published.has(service)
            )
                deps.lifecycle.seen(service);
        }
        return resolved;
    };

    const routes = async (): Promise<Route[]> =>
        (await refresh())?.routes ?? [];
    const upstream = async (
        route: Route,
    ): Promise<ProxyUpstream | undefined> => {
        const resolved = await refresh();
        if (!resolved) return undefined;
        const hostPort = resolved.published.get(route.service)?.get(route.port);
        if (hostPort) return { host: '127.0.0.1', port: hostPort };
        const address = resolved.addresses.get(route.service);
        return address ? { host: address, port: route.port } : undefined;
    };
    const chainFor = (service: string): string[] =>
        lazyChain(service, dependencies);
    return { routes, upstream, knownLazy, chainFor };
}

/**
 * Starts and stops services through the live controller (existing path).
 * A start carries the service's whole dependency chain, dependencies first,
 * so a cold-started lazy service finds its lazy dependencies running.
 */
function controllerLifecycle(
    controller: (() => LiveController | undefined) | undefined,
    log: (message: string) => void,
    chainFor: (service: string) => string[] = (service) => [service],
) {
    const act = async (
        services: readonly string[],
        action: 'start' | 'stop',
    ): Promise<void> => {
        const live = controller?.();
        if (!live) throw new Error('The environment is not running.');
        const result = await live.serviceAction(services, action);
        if (!result.ok) throw new Error(result.message || `${action} failed`);
    };
    return {
        start: (service: string) => act(chainFor(service), 'start'),
        stop: (service: string) => act([service], 'stop'),
        log,
    };
}

function bindFailureMessage(
    error: NodeJS.ErrnoException,
    port: number,
): string {
    const owned = error.code === 'EACCES' || error.code === 'EADDRINUSE';
    return (
        `proxy idle on port ${port}: ${error.code ?? error.message}` +
        (owned ? ' - the current ingress still owns it' : '')
    );
}

function startIdleSweeper(
    lifecycle: ServiceLifecycle,
    accounting: RequestAccounting,
): NodeJS.Timeout {
    const sweeper = setInterval(() => {
        void lifecycle
            .sweep(Date.now())
            .then((unloaded) => {
                for (const service of unloaded) accounting.reset(service);
            })
            .catch(() => {});
    }, IDLE_SWEEP_MS);
    sweeper.unref();
    return sweeper;
}
