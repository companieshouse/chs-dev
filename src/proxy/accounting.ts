/**
 * Per-service request counters for the proxy. Healthcheck-shaped requests
 * are counted separately from real traffic, so idle unload (ticket 12) can
 * trust the activity signal. All state is in memory; counters reset when a
 * service starts or stops.
 */
export interface AccountingSnapshot {
    /** Proxied requests per service, healthcheck traffic excluded. */
    counts: Record<string, number>;
    /** Healthcheck-shaped requests per service, kept for evidence. */
    excluded: Record<string, number>;
}

export interface RequestAccounting {
    record(
        service: string,
        path: string,
        healthchecks: readonly string[],
    ): void;
    count(service: string): number;
    snapshot(): AccountingSnapshot;
    reset(service: string): void;
}

export function createAccounting(): RequestAccounting {
    const counts = new Map<string, number>();
    const excluded = new Map<string, number>();
    return {
        record(service, path, healthchecks) {
            const bucket = isHealthcheck(path, healthchecks)
                ? excluded
                : counts;
            bucket.set(service, (bucket.get(service) ?? 0) + 1);
        },
        count: (service) => counts.get(service) ?? 0,
        snapshot: () => ({
            counts: Object.fromEntries([...counts].sort(sortEntries)),
            excluded: Object.fromEntries([...excluded].sort(sortEntries)),
        }),
        reset: (service) => {
            counts.delete(service);
            excluded.delete(service);
        },
    };
}

function sortEntries(
    [a]: readonly [string, unknown],
    [b]: readonly [string, unknown],
) {
    return a.localeCompare(b);
}

/** A healthcheck probe hits its configured URL path exactly. */
export function isHealthcheck(
    path: string,
    healthchecks: readonly string[],
): boolean {
    const bare = path.split('?')[0]!;
    return healthchecks.some(
        (configured) => bare === configured || bare === `${configured}/`,
    );
}

/**
 * Extracts the URL paths a container's healthcheck probes, from the engine
 * healthcheck command (typically a curl or wget line). Healthchecks run
 * container-to-container and never traverse the proxy, but other automated
 * traffic re-uses their paths through it.
 */
export function healthcheckPaths(healthcheck: unknown): string[] {
    const commands = healthcheckCommands(healthcheck);
    const paths = new Set<string>();
    for (const command of commands) {
        for (const url of command.matchAll(URL_PATTERN)) {
            const path = url[1] ?? url[2] ?? '/';
            if (path.startsWith('/')) paths.add(path);
        }
    }
    return [...paths].sort();
}

const URL_PATTERN =
    /https?:\/\/[^/\s'"|]+([^\s'"|]*)?|(?:localhost|127\.0\.0\.1)(?::\d+)?(\/[^\s'"|]*)?/g;

function healthcheckCommands(healthcheck: unknown): string[] {
    const test = (healthcheck as { Test?: unknown } | undefined)?.Test;
    if (!Array.isArray(test)) return [];
    return test.filter((entry): entry is string => typeof entry === 'string');
}
