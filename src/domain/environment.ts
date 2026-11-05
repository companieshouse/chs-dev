import type { ServiceStatus } from './runtime.js';
import type { ServiceDetails } from './services.js';

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
