import type { ServiceStatus } from '../../domain/runtime.js';

export interface ContainerSnapshot {
    labels: Record<string, string>;
    state: {
        Status: string;
        Health?: { Status: string };
        ExitCode?: number;
        OOMKilled?: boolean;
    };
}

const healthStatuses: Record<string, ServiceStatus> = {
    healthy: 'Healthy',
    unhealthy: 'Unhealthy',
    starting: 'Starting',
};

export function containerStatus(
    state: ContainerSnapshot['state'],
): ServiceStatus {
    if (state.Status === 'running') {
        const health = state.Health?.Status;
        return (health && healthStatuses[health]) || 'Running';
    }
    const exited = exitedStatus(state);
    if (exited) return exited;
    const states: Record<string, ServiceStatus> = {
        created: 'Stopped',
        exited: 'Exited',
        restarting: 'Restarting',
        paused: 'Paused',
        removing: 'Removing',
        dead: 'Dead',
    };
    return states[state.Status] ?? 'Unknown';
}

function exitedStatus(
    state: ContainerSnapshot['state'],
): ServiceStatus | undefined {
    if (state.Status === 'exited' && state.ExitCode !== undefined) {
        // One-shot jobs exit 0 without a healthcheck; SIGTERM/SIGKILL exits
        // come from `docker stop` rather than a crash.
        if (state.ExitCode === 0) return state.Health ? 'Stopped' : 'Completed';
        if (
            state.ExitCode === 143 ||
            (state.ExitCode === 137 && !state.OOMKilled)
        )
            return 'Stopped';
    }
    return undefined;
}
