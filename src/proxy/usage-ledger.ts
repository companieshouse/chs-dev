/**
 * Per-run traffic evidence for the usage cache: which services received real
 * (non-healthcheck) proxied requests and how many requests the run saw in
 * total. Unlike the request counters this survives idle-unloads and restarts,
 * so a run's verdict covers the whole period between apply boundaries.
 */
export interface UsageEvidence {
    /** Services that received at least one real request, sorted. */
    used: string[];
    /** Total real requests observed in the run. */
    total: number;
}

export interface UsageLedger {
    record(service: string): void;
    evidence(): UsageEvidence;
    reset(): void;
}

export function createUsageLedger(): UsageLedger {
    const used = new Set<string>();
    let total = 0;
    return {
        record: (service) => {
            used.add(service);
            total++;
        },
        evidence: () => ({
            used: [...used].sort((a, b) => a.localeCompare(b)),
            total,
        }),
        reset: () => {
            used.clear();
            total = 0;
        },
    };
}
