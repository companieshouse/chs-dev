import type { PreparationExclusion, RuntimeContainer } from './live.js';
import type { ServiceStatus } from './runtime.js';
import type { ServiceDetails } from './services.js';
import { classifyFailure } from './failure-classification.js';

export type EnvironmentState =
    | 'Checking'
    | 'Unknown'
    | 'Empty'
    | 'Ready'
    | 'Starting'
    | 'Issues'
    | 'Partial'
    | 'Stopped';

export interface EnvironmentSummary {
    state: EnvironmentState;
    total: number;
    up: number;
    starting: number;
    failed: string[];
    label: string;
}

const upStatuses = new Set<ServiceStatus>(['Running', 'Healthy', 'Completed']);
const startingStatuses = new Set<ServiceStatus>(['Starting', 'Restarting']);
const failedStatuses = new Set<ServiceStatus>(['Unhealthy', 'Exited', 'Dead']);

export function environmentSummary(
    details: Record<string, ServiceDetails>,
    statuses: Record<string, ServiceStatus>,
    runtimeState: 'loading' | 'ready' | 'error',
    applying = false,
): EnvironmentSummary {
    const enabled = Object.entries(details)
        .filter(([, detail]) => detail.enabled === 'Yes')
        .map(([name]) => name)
        .sort();
    const total = enabled.length;
    const summary = (
        state: EnvironmentState,
        label: string,
        counts: Partial<EnvironmentSummary> = {},
    ): EnvironmentSummary => ({
        state,
        total,
        up: 0,
        starting: 0,
        failed: [],
        label,
        ...counts,
    });
    const pending = availabilitySummary(runtimeState, total, summary);
    if (pending) return pending;
    const current = enabled.map((name) => statuses[name] ?? 'Stopped');
    const up = current.filter((status) => upStatuses.has(status)).length;
    const starting = current.filter((status) =>
        startingStatuses.has(status),
    ).length;
    const failed = enabled.filter((_, index) =>
        failedStatuses.has(current[index]!),
    );
    const counts = { up, starting, failed };
    const ratio = `${up}/${total}`;
    if (applying || (starting && !failed.length))
        return summary('Starting', `Starting ${ratio}`, counts);
    if (failed.length)
        return summary(
            'Issues',
            `${failed.length} failing · ${ratio} up`,
            counts,
        );
    if (up === total) return summary('Ready', `Ready ${ratio}`, counts);
    if (!up) return summary('Stopped', 'Stopped', counts);
    return summary('Partial', `Partially up ${ratio}`, counts);
}

/** What the daemon proxy knows: traffic counters and lazy/cold-start sets. */
export interface ProxyState {
    counts: Record<string, number>;
    excluded: Record<string, number>;
    coldStarting: string[];
    lazy: string[];
}

export type BlockerState =
    'excluded' | 'cold-starting' | 'failing' | 'blocked' | 'lazy-idle';

/** One service's first causal blocker, with remediation. */
export interface ServiceBlocker {
    service: string;
    state: BlockerState;
    detail: string;
}

export interface BlockerInput {
    enabled: readonly string[];
    statuses: Readonly<Record<string, ServiceStatus>>;
    containers?: readonly RuntimeContainer[];
    exclusions?: readonly PreparationExclusion[];
    /** Service dependencies by name, from the checkout definitions. */
    dependencies?: Readonly<Record<string, readonly string[]>>;
    lazy?: ReadonlySet<string>;
    coldStarting?: readonly string[];
}

const unhealthyStatuses = new Set<ServiceStatus>([
    'Unhealthy',
    'Exited',
    'Dead',
]);

/**
 * Derives each enabled service's first causal blocker, ordered per service:
 * durable-start exclusion, cold start, container failure (classified),
 * unmet dependency, lazy idle. Deterministic; at most one row per service;
 * healthy services produce none.
 */
export function serviceBlockers(input: BlockerInput): ServiceBlocker[] {
    const statuses = input.statuses;
    const containers = new Map(
        (input.containers ?? []).map((container) => [
            container.service,
            container,
        ]),
    );
    const exclusions = new Map<string, PreparationExclusion>();
    for (const exclusion of input.exclusions ?? [])
        for (const service of exclusion.services)
            exclusions.set(service, exclusion);
    const coldStarting = new Set(input.coldStarting ?? []);
    const active = input.enabled.some((service) => {
        const status = statuses[service];
        return status !== undefined && status !== 'Stopped';
    });
    const blockers: ServiceBlocker[] = [];
    for (const service of [...input.enabled].sort()) {
        const blocker = blockerFor(service, input, {
            containers,
            exclusions,
            coldStarting,
            active,
        });
        if (blocker) blockers.push(blocker);
    }
    return blockers;
}

function blockerFor(
    service: string,
    input: BlockerInput,
    context: {
        containers: Map<string, RuntimeContainer>;
        exclusions: Map<string, PreparationExclusion>;
        coldStarting: Set<string>;
        active: boolean;
    },
): ServiceBlocker | undefined {
    const exclusion = context.exclusions.get(service);
    if (exclusion)
        return {
            service,
            state: 'excluded',
            detail: `${exclusion.variable} missing - ${exclusion.remediation}`,
        };
    if (context.coldStarting.has(service))
        return {
            service,
            state: 'cold-starting',
            detail: 'starting on first request',
        };
    const status = input.statuses[service];
    const failing = failingClassification(service, status, input, context);
    if (failing) return failing;
    if (context.active && (status === undefined || status === 'Stopped')) {
        const blockedBy = unmetDependency(service, input);
        if (blockedBy) return { service, state: 'blocked', detail: blockedBy };
        if (input.lazy?.has(service))
            return {
                service,
                state: 'lazy-idle',
                detail: 'stopped (starts on first request)',
            };
    }
    return undefined;
}

function failingClassification(
    service: string,
    status: ServiceStatus | undefined,
    input: BlockerInput,
    context: {
        containers: Map<string, RuntimeContainer>;
    },
): ServiceBlocker | undefined {
    const container = context.containers.get(service);
    const failedStatus = unhealthyStatuses.has(status ?? 'Running');
    if (!container && !failedStatus) return undefined;
    const classification = classifyFailure({
        oomKilled: container?.oomKilled === true ? true : undefined,
        exitCode: failedStatus ? container?.exitCode : undefined,
        health: status === 'Unhealthy' ? 'unhealthy' : undefined,
    });
    if (classification.class === 'unknown') return undefined;
    return { service, state: 'failing', detail: classification.reason };
}

function unmetDependency(
    service: string,
    input: BlockerInput,
): string | undefined {
    for (const dependency of input.dependencies?.[service] ?? []) {
        const status = input.statuses[dependency];
        if (unhealthyStatuses.has(status ?? 'Running'))
            return `${dependency} not healthy`;
    }
    return undefined;
}

function availabilitySummary(
    runtimeState: 'loading' | 'ready' | 'error',
    total: number,
    summary: (state: EnvironmentState, label: string) => EnvironmentSummary,
) {
    if (runtimeState === 'loading') return summary('Checking', 'Checking…');
    if (runtimeState === 'error') return summary('Unknown', 'Status unknown');
    if (!total) return summary('Empty', 'No services enabled');

    return undefined;
}
