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
    start(service: string, deadline?: number): Promise<void>;
    /** Gracefully stops the service. */
    stop(service: string): Promise<void>;
    /** Stops lazy services idle past the window; returns what unloaded. */
    sweep(now: number): Promise<string[]>;
    /** Waits for an accepted idle stop of the service or its dependencies. */
    settled(service: string): Promise<void>;
    /** Protects a request and its dependency chain until the returned release. */
    request(service: string): () => void;
    /** Forgets activity when the active controller or checkout changes. */
    reset(): void;
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

interface LifecycleDependencies {
    isLazy(service: string): boolean;
    start(service: string, deadline?: number): Promise<void>;
    stop(service: string): Promise<void>;
    chainFor?(service: string): readonly string[];
    log?: ProxyLog;
}

class LazyLifecycle implements ServiceLifecycle {
    private activity = new Map<string, { at: number }>();
    private starting = new Map<string, Promise<void>>();
    private requests = new Map<string, number>();
    private stopping = new Map<string, Promise<void>>();
    private generation = 0;

    constructor(private readonly deps: LifecycleDependencies) {}

    isLazy(service: string) {
        return this.deps.isLazy(service);
    }

    private chain(service: string) {
        return this.deps.chainFor?.(service) ?? [service];
    }

    touch(service: string) {
        for (const name of this.chain(service))
            this.activity.set(name, { at: Date.now() });
    }

    seen(service: string) {
        if (!this.activity.has(service))
            this.activity.set(service, { at: Date.now() });
    }

    request(service: string) {
        const chain = this.chain(service);
        const generation = this.generation;
        let released = false;
        for (const name of chain)
            this.requests.set(name, (this.requests.get(name) ?? 0) + 1);
        this.touch(service);
        return () => {
            if (released || generation !== this.generation) return;
            released = true;
            for (const name of chain) {
                this.requests.set(
                    name,
                    Math.max(0, (this.requests.get(name) ?? 0) - 1),
                );
                this.activity.set(name, { at: Date.now() });
            }
        };
    }

    start(service: string, deadline?: number): Promise<void> {
        const inflight = this.starting.get(service);
        if (inflight) return inflight;
        const release = this.request(service);
        const started = this.deps.start(service, deadline).finally(() => {
            release();
            if (this.starting.get(service) === started)
                this.starting.delete(service);
        });
        this.starting.set(service, started);
        return started;
    }

    settled(service: string): Promise<void> {
        return Promise.all(
            this.chain(service).map((name) =>
                this.stopping.get(name)?.catch(() => {}),
            ),
        ).then(() => {});
    }

    stop(service: string): Promise<void> {
        const inflight = this.stopping.get(service);
        if (inflight) return inflight;
        const generation = this.generation;
        const last = this.activity.get(service);
        const stopped = this.deps
            .stop(service)
            .then(() => {
                if (
                    generation === this.generation &&
                    this.activity.get(service) === last &&
                    (this.requests.get(service) ?? 0) === 0
                )
                    this.activity.delete(service);
            })
            .finally(() => {
                if (this.stopping.get(service) === stopped)
                    this.stopping.delete(service);
            });
        this.stopping.set(service, stopped);
        return stopped;
    }

    reset() {
        this.generation++;
        this.activity.clear();
        this.starting.clear();
        this.stopping.clear();
        this.requests.clear();
    }

    coldStarting() {
        return [...this.starting.keys()].sort();
    }

    private async unload(service: string) {
        try {
            await this.stop(service);
            return true;
        } catch {
            this.deps.log?.(`idle unload of ${service} failed; will retry`, {
                service,
                cause: 'idle-unload',
                status: 'failed',
            });
            return false;
        }
    }

    async sweep(now: number): Promise<string[]> {
        const unloaded: string[] = [];
        const generation = this.generation;
        for (const [service, { at: last }] of this.activity) {
            if (!this.deps.isLazy(service)) continue;
            if (
                now - last < IDLE_UNLOAD_MS ||
                (this.requests.get(service) ?? 0) > 0
            )
                continue;
            const stopped = await this.unload(service);
            if (generation !== this.generation) return [];
            if (!stopped) continue;
            unloaded.push(service);
            this.deps.log?.(`unloaded idle service ${service}`, {
                service,
                cause: 'idle-unload',
                status: 'success',
            });
        }
        return unloaded;
    }
}

export function createLazyLifecycle(
    deps: LifecycleDependencies,
): ServiceLifecycle {
    return new LazyLifecycle(deps);
}
