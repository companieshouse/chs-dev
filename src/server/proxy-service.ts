import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createProxyServer, type ProxyUpstream } from '../proxy/server.js';
import { createRouteBuilder, type ResolvedRoutes } from '../proxy/builder.js';
import {
    createAccounting,
    healthcheckPaths,
    type RequestAccounting,
} from '../proxy/accounting.js';
import type { UsageLedger } from '../proxy/usage-ledger.js';
import {
    createLazyLifecycle,
    IDLE_SWEEP_MS,
    LAZY_REFRESH_MS,
    lazyChain,
    type ProxyLog,
    type ServiceLifecycle,
} from '../proxy/lifecycle.js';
import { mergeRoutes, routeTable, type Route } from '../proxy/routes.js';
import type { ContainerManager } from '../domain/containers.js';
import type { LiveController } from '../application/live-controller.js';
import type { RuntimeStrategy } from '../domain/runtime-strategy.js';
import { readProjectConfig } from '../project/config.js';
import { labels, type Mapping } from '../project/compose.js';
import {
    loadDefinitions,
    readState,
    resolveSelection,
} from '../project/resolve.js';
import { loadUsagePolicy } from '../project/usage-cache.js';
import { selectedJourney } from '../project/journeys.js';
import { nodeProjectFs } from '../project/files.js';
import { selectRuntime } from '../infrastructure/runtimes/select-runtime.js';
import { tuiLog } from '../infrastructure/tui-log.js';

/** The host port the current ingress (Traefik) listens on. */
export const PROXY_PORT = 80;

/** Cached-route lifetime; applies converge within this window. */
const ROUTE_REFRESH_MS = 2000;

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
 * the running containers plus the checkout's lazy definitions (so a stopped
 * lazy service still routes), upstreams are the same containers and ports
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
        /** Whether learned usage modes apply; polled per route refresh. */
        usageCache?: () => boolean;
        /** Test override for the busy-port retry interval. */
        bindRetryMs?: number;
        /** Test override for the ingress port. */
        portOverride?: number;
    } = {},
): DaemonProxy {
    const runtime = options.runtime?.() ?? selectRuntime();
    const accounting = options.accounting ?? createAccounting();
    const usageCache = options.usageCache;
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
        log,
        usageCache,
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

interface RoutingState {
    active?: { directory: string; manager: ContainerManager };
    builder?: ReturnType<typeof createRouteBuilder>;
    cached?: { at: number; resolved: ResolvedRoutes };
    lazyCache?:
        { directory: string; at: number; services: Set<string> } | undefined;
    dependencies: Map<string, readonly string[]>;
    readonly knownLazy: Set<string>;
}

function createRouting(deps: {
    runtime: RuntimeStrategy;
    accounting: RequestAccounting;
    lifecycle: ServiceLifecycle;
    log(message: string): void;
    usageCache?: () => boolean;
}) {
    const state: RoutingState = {
        knownLazy: new Set(),
        dependencies: new Map(),
    };

    const projectManager = async () => {
        const project = await readProjectConfig();
        if (!project.valid) return undefined;
        const directory = await realpath(project.directory);
        if (state.active?.directory === directory) return state.active;
        const manager = deps.runtime.containers?.({ directory });
        if (!manager) return undefined;
        state.active = { directory, manager };
        state.builder = undefined;
        state.cached = undefined;
        state.lazyCache = undefined;
        return state.active;
    };

    const refresh = async (project: {
        directory: string;
        manager: ContainerManager;
    }): Promise<ResolvedRoutes> => {
        state.builder ??= createRouteBuilder(project.manager, deps.accounting);
        const resolved = await state.builder.current();
        const sets = await checkoutLazySets(project.directory, deps.usageCache);
        state.dependencies = sets.dependencies;
        state.knownLazy.clear();
        for (const service of sets.lazy) state.knownLazy.add(service);
        for (const service of sets.reclaimable) state.knownLazy.add(service);
        for (const service of state.knownLazy)
            if (
                resolved.addresses.has(service) ||
                resolved.published.has(service)
            )
                deps.lifecycle.seen(service);
        return resolved;
    };

    const routes = async (): Promise<Route[]> => {
        const project = await projectManager();
        if (!project) return [];
        if (state.cached && Date.now() - state.cached.at < ROUTE_REFRESH_MS)
            return state.cached.resolved.routes;
        const resolved = await refresh(project);
        state.cached = { at: Date.now(), resolved };
        let lazy: Route[] = [];
        try {
            lazy = await checkoutLazyRoutes(project.directory, deps.usageCache);
        } catch (error) {
            deps.log(
                `lazy route load failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return mergeRoutes(resolved.routes, lazy);
    };

    const upstream = async (
        route: Route,
    ): Promise<ProxyUpstream | undefined> => {
        const project = await projectManager();
        if (!project) return undefined;
        const resolved = await refresh(project);
        state.cached = { at: Date.now(), resolved };
        const hostPort = resolved.published.get(route.service)?.get(route.port);
        if (hostPort) return { host: '127.0.0.1', port: hostPort };
        const address = resolved.addresses.get(route.service);
        return address ? { host: address, port: route.port } : undefined;
    };

    const chainFor = (service: string): string[] =>
        lazyChain(service, state.dependencies);

    return { routes, upstream, knownLazy: state.knownLazy, chainFor };
}

/** Cached lazy and reclaimable sets; keyed by directory, refreshed at LAZY_REFRESH_MS. */
let lazySetsCache:
    | {
          directory: string;
          at: number;
          lazy: Set<string>;
          reclaimable: Set<string>;
          dependencies: Map<string, readonly string[]>;
      }
    | undefined;

/**
 * Proxy-managed services from the checkout definitions: lazy ones (journey
 * or label) plus derived members the usage cache may reclaim. Both sets
 * route, cold-start on request and idle-unload; briefly cached.
 */
async function checkoutLazySets(
    directory: string,
    usageCache?: () => boolean,
): Promise<{
    lazy: Set<string>;
    reclaimable: Set<string>;
    dependencies: Map<string, readonly string[]>;
}> {
    if (
        lazySetsCache?.directory === directory &&
        Date.now() - lazySetsCache.at < LAZY_REFRESH_MS
    )
        return lazySetsCache;
    const { definitions } = await loadDefinitions(directory, nodeProjectFs);
    const state = readState(
        await nodeProjectFs.readFile(join(directory, '.chs-dev.yaml')),
    );
    const journey = await selectedJourney(
        directory,
        state.journey,
        nodeProjectFs,
    );
    const usage = await loadUsagePolicy(
        directory,
        usageCache?.() ?? false,
        nodeProjectFs,
    );
    const { entries, dependencies } = resolveSelection(
        definitions,
        state,
        journey,
        usage,
    );
    const lazy = new Set(
        entries.filter((entry) => entry.lazy).map((entry) => entry.service),
    );
    const reclaimable = new Set(
        entries
            .filter((entry) => entry.reclaimable)
            .map((entry) => entry.service),
    );
    lazySetsCache = {
        directory,
        at: Date.now(),
        lazy,
        reclaimable,
        dependencies,
    };
    return lazySetsCache;
}

/** Definition-based routes for proxy-managed services, stopped ones included. */
async function checkoutLazyRoutes(
    directory: string,
    usageCache?: () => boolean,
): Promise<Route[]> {
    const { definitions } = await loadDefinitions(directory, nodeProjectFs);
    const { lazy, reclaimable } = await checkoutLazySets(directory, usageCache);
    const sources = [...lazy, ...reclaimable]
        .filter((service) => definitions.has(service))
        .map((service) => {
            const spec = definitions.get(service)!.spec;
            return {
                service,
                labels: labels(spec.labels),
                containerPorts: exposedPorts(spec),
                healthcheckPaths: healthcheckPaths(spec.healthcheck),
            };
        });
    return routeTable(sources);
}

/** Container ports a compose spec exposes or publishes, for LB-port fallback. */
function exposedPorts(spec: Mapping): number[] {
    const exposed = Array.isArray(spec.expose) ? spec.expose : [];
    const declared = Array.isArray(spec.ports) ? spec.ports : [];
    const ports = new Set<number>();
    for (const entry of [...exposed, ...declared]) {
        const value = Number(
            typeof entry === 'string'
                ? entry.split(':').at(-1)!.split('/')[0]
                : entry,
        );
        if (Number.isFinite(value) && value > 0) ports.add(value);
    }
    return [...ports].sort((a, b) => a - b);
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
