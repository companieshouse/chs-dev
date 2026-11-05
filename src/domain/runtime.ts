export type ServiceStatus =
    | 'Loading…'
    | 'Stopped'
    | 'Starting'
    | 'Running'
    | 'Healthy'
    | 'Unhealthy'
    | 'Restarting'
    | 'Exited'
    | 'Completed'
    | 'Paused'
    | 'Removing'
    | 'Dead'
    | 'Unknown';
export function mergeStatus(
    current: ServiceStatus | undefined,
    next: ServiceStatus,
): ServiceStatus {
    const priority: ServiceStatus[] = [
        'Unknown',
        'Dead',
        'Unhealthy',
        'Restarting',
        'Exited',
        'Paused',
        'Removing',
        'Starting',
        'Stopped',
        'Completed',
        'Running',
        'Healthy',
    ];
    return !current || priority.indexOf(next) < priority.indexOf(current)
        ? next
        : current;
}
