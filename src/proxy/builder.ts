import type {
    ContainerDetails,
    ContainerManager,
    ContainerSummary,
} from '../domain/containers.js';
import { appliedServicePolicy, lifecycleLabel } from '../domain/live.js';
import { routeTable, type Route, type RouteSource } from './routes.js';
import { healthcheckPaths } from './accounting.js';
import type { RequestAccounting } from './accounting.js';

export interface ResolvedRoutes {
    routes: Route[];
    lazy: Set<string>;
    dependencies: Map<string, readonly string[]>;
    /** Routing-network address per service. */
    addresses: Map<string, string>;
    /** Published host port per service container port, when published. */
    published: Map<string, Map<number, number>>;
}

/**
 * Builds routes and lifecycle policy from owned applied containers, including
 * stopped lazy containers. Only running containers provide upstream addresses.
 * Requests hit the cached table; only a changed fingerprint
 * triggers fresh inspections. When a service's container starts, stops, or
 * is recreated, its request counters reset.
 */
export function createRouteBuilder(
    manager: ContainerManager,
    accounting?: RequestAccounting,
) {
    let cache:
        | {
              fingerprint: string;
              perService: Map<string, string>;
              resolved: ResolvedRoutes;
          }
        | undefined;
    let inflight: Promise<ResolvedRoutes> | undefined;
    return {
        async current(): Promise<ResolvedRoutes> {
            if (inflight) return inflight;
            const containers = (await manager.list()).filter(
                (container) => container.currentProject,
            );
            const perService = fingerprintByService(containers);
            const fingerprint = [...perService.entries()]
                .map(([service, mark]) => `${service}=${mark}`)
                .sort()
                .join('|');
            if (cache?.fingerprint === fingerprint) return cache.resolved;
            inflight = rebuild(manager, containers).then((resolved) => {
                resetChanged(accounting, cache?.perService, perService);
                cache = { fingerprint, perService, resolved };
                return resolved;
            });
            try {
                return await inflight;
            } finally {
                inflight = undefined;
            }
        },
    };
}

function fingerprintByService(containers: ContainerSummary[]) {
    const marks = new Map<string, string>();
    for (const container of containers)
        if (container.service)
            marks.set(
                container.service,
                `${container.id}:${container.state}:${container.health ?? ''}`,
            );
    return marks;
}

function resetChanged(
    accounting: RequestAccounting | undefined,
    before: Map<string, string> | undefined,
    after: Map<string, string>,
) {
    if (!accounting) return;
    for (const [service, mark] of after)
        if (before?.get(service) !== mark) accounting.reset(service);
    for (const service of before?.keys() ?? [])
        if (!after.has(service)) accounting.reset(service);
}

const UNROUTED = new Set(['ingress-proxy', 'chs-dev-microcks']);

async function inspectApplied(
    manager: ContainerManager,
    container: ContainerSummary,
) {
    if (!container.service || container.service === 'ingress-proxy')
        return undefined;
    const details = await manager.inspect(container.id);
    const labeled = serviceLabels(details);
    if (!labeled) return undefined;
    return {
        service: container.service,
        details,
        labeled,
        policy: appliedServicePolicy(
            labeled[lifecycleLabel],
            container.service,
        ),
    };
}

async function rebuild(
    manager: ContainerManager,
    containers: ContainerSummary[],
): Promise<ResolvedRoutes> {
    const addresses = new Map<string, string>();
    const published = new Map<string, Map<number, number>>();
    const sources: RouteSource[] = [];
    const lazy = new Set<string>();
    const dependencies = new Map<string, readonly string[]>();
    for (const container of containers) {
        const applied = await inspectApplied(manager, container);
        if (!applied) continue;
        const { service, details, labeled, policy } = applied;
        dependencies.set(service, policy.dependencies);
        if (policy.lazy || policy.reclaimable) lazy.add(service);
        if (!routable(container.state, service, lazy)) continue;
        if (readyForTraffic(container.state, details.health)) {
            addresses.set(service, addressOf(details));
            published.set(service, publishedPorts(details));
        }
        sources.push({
            service,
            labels: labeled,
            containerPorts: containerPorts(details),
            healthcheckPaths: probePaths(details, labeled),
        });
    }
    return {
        routes: routeTable(sources),
        addresses,
        published,
        lazy,
        dependencies,
    };
}

function routable(state: string, service: string, lazy: ReadonlySet<string>) {
    return !UNROUTED.has(service) && (isRunning(state) || lazy.has(service));
}

function readyForTraffic(state: string, health: string | undefined) {
    return isRunning(state) && (health === undefined || health === 'healthy');
}

function isRunning(state: string) {
    return ['running', 'healthy', 'starting', 'restarting'].includes(
        state.toLowerCase(),
    );
}

function serviceLabels(details: ContainerDetails) {
    const labels = (
        details.inspection as
            { Config?: { Labels?: Record<string, unknown> } } | undefined
    )?.Config?.Labels;
    return labels && Object.keys(labels).length ? labels : undefined;
}

/**
 * Health-probe paths for accounting: the engine healthcheck plus any
 * health paths a generated mock declares on its metadata label.
 */
function probePaths(
    details: ContainerDetails,
    labels: Record<string, unknown>,
): string[] {
    const engine = healthcheckPaths(
        (
            details.inspection as
                { Config?: { Healthcheck?: unknown } } | undefined
        )?.Config?.Healthcheck,
    );
    const declared = String(labels['chs.dev.mock.health-paths'] ?? '')
        .split(',')
        .map((path) => path.trim())
        .filter((path) => path.startsWith('/'));
    return [...new Set([...engine, ...declared])].sort((a, b) =>
        a.localeCompare(b),
    );
}

function addressOf(details: ContainerDetails): string {
    const networks = details.networks;
    const chs = networks.find((network) => network.name === 'chs');
    return chs?.addresses[0] ?? networks[0]?.addresses[0] ?? '';
}

function containerPorts(details: ContainerDetails): number[] {
    const published = publishedPorts(details);
    const exposed = Object.keys(
        (
            details.inspection as
                | { Config?: { ExposedPorts?: Record<string, unknown> } }
                | undefined
        )?.Config?.ExposedPorts ?? {},
    )
        .map((key) => Number(key.split('/')[0]))
        .filter((port) => Number.isFinite(port));
    return [...new Set([...published.keys(), ...exposed])].sort(
        (a, b) => a - b,
    );
}

function publishedPorts(details: ContainerDetails): Map<number, number> {
    const ports = networkPorts(details);
    const result = new Map<number, number>();
    for (const [key, bindings] of Object.entries(ports)) {
        const container = Number(key.split('/')[0]);
        const host = Number(hostBinding(bindings));
        if (validPortValue(container) && validPortValue(host))
            result.set(container, host);
    }
    return result;
}

function networkPorts(
    details: ContainerDetails,
): Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> {
    return (
        (
            details.inspection as
                | {
                      NetworkSettings?: {
                          Ports?: Record<
                              string,
                              Array<{
                                  HostIp?: string;
                                  HostPort?: string;
                              }> | null
                          >;
                      };
                  }
                | undefined
        )?.NetworkSettings?.Ports ?? {}
    );
}

function hostBinding(
    bindings: Array<{ HostIp?: string; HostPort?: string }> | null | undefined,
) {
    return (
        bindings?.find(
            (candidate) =>
                candidate.HostIp === '127.0.0.1' ||
                candidate.HostIp === '0.0.0.0',
        ) ?? bindings?.[0]
    )?.HostPort;
}

function validPortValue(value: number) {
    return Number.isFinite(value) && value > 0;
}
