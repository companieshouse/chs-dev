/**
 * Lazy-service lifecycle policy: a request to a stopped lazy service starts
 * it and is held until the upstream is reachable or the hold expires; an
 * idle lazy service is gracefully stopped after the idle window.
 * Always-start services never unload. Tuning values are code constants.
 */
export const COLD_START_HOLD_MS = 90_000;
export const COLD_START_POLL_MS = 500;
export const IDLE_UNLOAD_MS = 30 * 60_000;
export const IDLE_SWEEP_MS = 60_000;

/** Structured proxy event fields; the log allowlist admits exactly these. */
export interface ProxyEvent {
    service?: string;
    cause:
        | 'cold-start'
        | 'hold-cap'
        | 'idle-unload'
        | 'start-failed'
        | 'bind-failed'
        | 'bind-acquired'
        | 'route-load-failed';
    status: 'start' | 'success' | 'failed';
}

export type ProxyLog = (message: string, event?: ProxyEvent) => void;

export interface ServiceLifecycle {
    /** True when the service defers start (journey lazy marking). */
    isLazy(service: string): boolean;
    /** Records non-healthcheck traffic; refreshes the idle timer. */
    touch(service: string): void;
    /** Seeds the idle timer when a lazy service is first seen running. */
    seen(service: string): void;
    /** Starts the service; concurrent starts share one call. */
    start(service: string): Promise<void>;
    /** Gracefully stops the service. */
    stop(service: string): Promise<void>;
    /** Stops lazy services idle past the window; returns what unloaded. */
    sweep(now: number): Promise<string[]>;
    /** Services with an in-flight cold start. */
    coldStarting(): string[];
}

/**
 * The start chain for a called service: its transitive dependencies in
 * dependency-first order, then the service itself. Dependencies that are
 * already running are started again harmlessly by callers filtering to
 * stopped containers; eager dependencies are included because a starting
 * service needs them regardless of their own start mode.
 */
export function lazyChain(
    service: string,
    dependencies: ReadonlyMap<string, readonly string[]>,
): string[] {
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visit = (name: string) => {
        if (visited.has(name)) return;
        visited.add(name);
        for (const dependency of dependencies.get(name) ?? [])
            visit(dependency);
        ordered.push(name);
    };
    visit(service);
    return ordered;
}

export function createLazyLifecycle(deps: {
    isLazy(service: string): boolean;
    start(service: string): Promise<void>;
    stop(service: string): Promise<void>;
    log?: ProxyLog;
}): ServiceLifecycle {
    const activity = new Map<string, number>();
    const starting = new Map<string, Promise<void>>();
    return {
        isLazy: (service) => deps.isLazy(service),
        touch: (service) => {
            activity.set(service, Date.now());
        },
        seen: (service) => {
            if (!activity.has(service)) activity.set(service, Date.now());
        },
        start: (service) => {
            const inflight = starting.get(service);
            if (inflight) return inflight;
            const started = deps
                .start(service)
                .catch((error: unknown) => {
                    starting.delete(service);
                    throw error;
                })
                .then(() => {
                    starting.delete(service);
                    activity.set(service, Date.now());
                });
            starting.set(service, started);
            return started;
        },
        stop: async (service) => {
            await deps.stop(service);
            activity.delete(service);
        },
        coldStarting: () => [...starting.keys()].sort(),
        sweep: async (now) => {
            const unloaded: string[] = [];
            for (const [service, last] of activity) {
                if (!deps.isLazy(service)) continue;
                if (now - last < IDLE_UNLOAD_MS) continue;
                activity.delete(service);
                try {
                    await deps.stop(service);
                } catch (error) {
                    deps.log?.(
                        `idle unload of ${service} failed: ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`,
                        {
                            service,
                            cause: 'idle-unload',
                            status: 'failed',
                        },
                    );
                    continue;
                }
                unloaded.push(service);
                deps.log?.(`unloaded idle service ${service}`, {
                    service,
                    cause: 'idle-unload',
                    status: 'success',
                });
            }
            return unloaded;
        },
    };
}
